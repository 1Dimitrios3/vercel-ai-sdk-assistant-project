import BM25 from 'okapibm25';
import fs from "fs/promises";
import path from 'path';
import { embedMany, embed, cosineSimilarity } from 'ai';
import { openai } from '@ai-sdk/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { ensureEmbeddingsCacheDirectory, getCachedEmbedding, getEmbeddingFilePath, writeEmbeddingToCache } from './embeddings';
import { Item } from '@radix-ui/react-dropdown-menu';

export interface Email {
    id: string;
    threadId: string;
    from: string;
    to: string | string[];
    cc?: string[];
    subject: string;
    body: string;
    timestamp: string;
    inReplyTo?: string;
    references?: string[];
    labels?: string[];
    arcId?: string;
    phaseId?: number;
}

export type EmailChunk = {
    id: string;
    subject: string;
    chunk: string;
    index: number;
    totalChunks: number;
    from: string;
    to: string | string[];
    timestamp: string;
};

const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 100,
    separators: ['\n\n', '\n', ' ', ''],
})

export const emailChunkToText = (email: EmailChunk) =>
    `${email.subject} ${email.chunk}`;

export const emailChunkToId = (email: EmailChunk) =>
    `${email.id}-${email.index}`;


export async function searchWithBM25<T>(
    keywords: string[],
    items: T[],
    toText: (item: T) => string,
) {
    const corpus = items.flatMap((item) => toText(item));

    const scores: number[] = (BM25 as any)(corpus, keywords);

    return scores
        .map((score, idx) => ({ score, item: items[idx] }))
        .sort((a, b) => b.score - a.score);
}

export async function loadEmails(): Promise<Email[]> {
    const filePath = path.join(
        process.cwd(),
        'data',
        'emails.json',
    );
    const fileContent = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(fileContent);
}


export async function loadOrGenerateEmbeddings<T>(
    items: T[],
    toText: (item: T) => string
): Promise<{ item: T; embedding: number[] }[]> {
    // Ensure cache directory exists
    await ensureEmbeddingsCacheDirectory();

    const results: { item: T; embedding: number[] }[] = [];
    const uncachedItems: T[] = [];

    // Check cache for each email
    for (const item of items) {
        const cachedEmbedding = await getCachedEmbedding(
            toText(item),
        );
        if (cachedEmbedding) {
            results.push({ item, embedding: cachedEmbedding });
        } else {
            uncachedItems.push(item);
        }
    }

    // Generate embeddings for uncached emails in batches of 99
    if (uncachedItems.length > 0) {
        console.log(
            `Generating embeddings for ${uncachedItems.length} emails`,
        );

        const BATCH_SIZE = 99;
        for (let i = 0; i < uncachedItems.length; i += BATCH_SIZE) {
            const batch = uncachedItems.slice(i, i + BATCH_SIZE);
            console.log(
                `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
                    uncachedItems.length / BATCH_SIZE,
                )}`,
            );

            const { embeddings } = await embedMany({
                model: openai.textEmbeddingModel("text-embedding-ada-002"),
                values: batch.map((item) => toText(item)),
            });

            // Write batch to cache
            for (let j = 0; j < batch.length; j++) {
                const item = batch[j];
                const embedding = embeddings[j];

                await writeEmbeddingToCache(toText(item), embedding);

                results.push({ item, embedding });
            }
        }
    }

    return results;
}

export async function searchWithEmbeddings<T>(
    query: string,
    items: T[],
    toText: (item: T) => string,
) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
        console.warn('Query must be a non-empty string');
        return [];
    }
    // Load cached embeddings
    const embeddings = await loadOrGenerateEmbeddings(
        items,
        toText,
    );

    // Generate query embedding
    const { embedding: queryEmbedding } = await embed({
        model: openai.textEmbeddingModel("text-embedding-ada-002"),
        value: query,
    });

    // Calculate similarity scores
    const results = embeddings.map(({ item, embedding }) => {
        const score = cosineSimilarity(queryEmbedding, embedding);
        return { score, item };
    });

    // Sort by similarity descending
    return results.sort((a, b) => b.score - a.score);
}


const RRF_K = 60;

// Combines multiple ranking lists using position-based scoring
export function reciprocalRankFusion<T>(
    rankings: { item: T; score: number }[][], // CHANGED: Generic item
    toId: (item: T) => string,
): { item: T; score: number }[] {
    const rrfScores = new Map<string, number>();
    const itemMap = new Map<string, T>();

    // Process each ranking list (BM25 and embeddings)
    rankings.forEach((ranking) => {
        ranking.forEach((result, rank) => {
            const itemId = toId(result.item)
            const currentScore = rrfScores.get(itemId) || 0;
            const contribution = 1 / (RRF_K + rank);
            rrfScores.set(itemId, currentScore + contribution);
            itemMap.set(itemId, result.item);
        });
    });

    // Sort by combined RRF score descending
    return Array.from(rrfScores.entries())
        .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
        .map(([itemId, score]) => ({
            score,
            item: itemMap.get(itemId)!,
        }));
}

export const searchEmailsWithRRF = async (
    query: string,
    emails: Email[],
) => {
    const emailChunks = await chunkEmails(emails);

    const bm25Ranking = await searchWithBM25(
        query.toLowerCase().split(' '),
        emailChunks,
        emailChunkToText
    );

    const embeddingsRanking = await searchWithEmbeddings(
        query,
        emailChunks,
        emailChunkToText
    );

    const rrfRanking = reciprocalRankFusion([
        bm25Ranking,
        embeddingsRanking!,
    ], emailChunkToText);

    return rrfRanking;
};

export const chunkEmails = async (emails: Email[]) => {
    const emailsWithChunks: EmailChunk[] = [];
    for (const email of emails) {
        const chunks = await textSplitter.splitText(email.body);

        chunks.forEach((chunk, chunkIndex) => {
            emailsWithChunks.push({
                id: email.id,
                index: chunkIndex,
                subject: email.subject,
                chunk,
                from: email.from,
                to: email.to,
                timestamp: email.timestamp,
                totalChunks: chunks.length,
            });
        });
    }
    return emailsWithChunks;
};