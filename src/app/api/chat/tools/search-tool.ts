import {
    chunkEmails,
    loadEmails,
    reciprocalRankFusion,
    searchWithBM25,
    searchWithEmbeddings,
    emailChunkToId,
    emailChunkToText
} from '@/app/search';
import { rerankEmails } from '@/app/rerank';
import { convertToModelMessages, tool, UIMessage } from 'ai';
import { z } from 'zod';

const NUMBER_PASSED_TO_RERANKER = 30;

export const searchTool = (messages: UIMessage[]) =>
    tool({
        description:
            "Search emails using both keyword and semantic search. Returns metadata with snippets only - use getEmails tool to fetch full content of specific emails.",
        inputSchema: z.object({
            keywords: z
                .array(z.string())
                .describe(
                    'Key terms extracted from query (names, nouns, important words). Provide these alongside searchQuery for best results.',
                )
                .optional(),
            searchQuery: z
                .string()
                .describe(
                    'Natural language query for semantic search (broader concepts)',
                )
                .optional(),
        }),
        execute: async ({ keywords, searchQuery }) => {
            console.log('=== TOOL CALLED ===');
            console.log('Keywords:', keywords);
            console.log('Search query:', searchQuery);

            try {
                if (!keywords?.length && !searchQuery) {
                    console.log('No search parameters provided');
                    return { emails: [], message: 'No search parameters provided' };
                }

                const emails = await loadEmails();

                const emailChunks = await chunkEmails(emails);

                const bm25Results = keywords
                    ? await searchWithBM25(keywords, emailChunks, emailChunkToText)
                    : [];

                const embeddingResults = searchQuery
                    ? await searchWithEmbeddings(
                        searchQuery,
                        emailChunks,
                        emailChunkToText,
                    )
                    : [];

                // Combine results using reciprocal rank fusion
                const rrfResults = reciprocalRankFusion([
                    bm25Results.slice(0, NUMBER_PASSED_TO_RERANKER),
                    embeddingResults.slice(0, NUMBER_PASSED_TO_RERANKER),
                ],
                    emailChunkToId
                );

                const conversationHistory = convertToModelMessages(messages)
                    .filter((m) => {
                        if (m.role === 'user') return true;
                        if (m.role === 'assistant') {
                            const content = m.content;
                            if (typeof content === 'string') return true;
                            if (Array.isArray(content)) {
                                return !content.some((part: any) => part.type === 'tool-call');
                            }
                        }
                        return false;
                    });;

                const query = [keywords?.join(' '), searchQuery]
                    .filter(Boolean)
                    .join(' ');

                const rerankedResults = await rerankEmails(
                    rrfResults.slice(0, NUMBER_PASSED_TO_RERANKER).map((r) => ({
                        email: r.item,
                        score: r.score
                    })),
                    query,
                    conversationHistory
                );
                console.log('rerankedResults. -->', rerankedResults)

                const topEmails = rerankedResults.map((r) => {
                    // Get full email to extract threadId
                    const fullEmail = emails.find((e) => e.id === r.email.id);
                    const snippet =
                        r.email.chunk.slice(0, 150).trim() +
                        (r.email.chunk.length > 150 ? '...' : '');

                    return {
                        id: r.email.id,
                        threadId: fullEmail?.threadId ?? '',
                        subject: r.email.subject,
                        from: r.email.from,
                        to: r.email.to,
                        timestamp: r.email.timestamp,
                        score: r.score,
                        snippet,
                    };
                });

                console.log('=== RETURNING RESULTS ===', topEmails.length);
                return {
                    emails: topEmails,
                };
            } catch (err) {
                console.error('=== TOOL ERROR ===', err);
                return { emails: [], error: String(err) };
            }


        },
    });