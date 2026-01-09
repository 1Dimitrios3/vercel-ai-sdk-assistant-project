import { DB, loadMemories } from '@/lib/persistence-layer';
import { MyMessage } from './api/chat/route';
import { searchWithEmbeddings } from './search';
import { messageHistoryToQuery } from './utils';

// Convert memory to searchable text format
export const memoryToText = (memory: DB.Memory) =>
    `${memory.title}: ${memory.content}`;

// Search memories semantically based on message history
export const searchMemories = async (opts: {
    messages: MyMessage[];
}) => {
    // Load all memories from persistence layer
    const memories = await loadMemories();

    // Convert message history to semantic query (with most recent message repeated)
    const query = messageHistoryToQuery(opts.messages);

    // Search and rank memories by relevance to query
    const embeddingsRanking = await searchWithEmbeddings(
        query,
        memories,
        memoryToText,
    );

    return embeddingsRanking;
};