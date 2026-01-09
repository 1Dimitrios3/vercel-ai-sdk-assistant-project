import {
    DB,
    getChat,
    updateChatLLMSummary,
} from '@/lib/persistence-layer';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import { chatToText } from './utils';
import { REFLECT_ON_CHAT_SYSTEM_PROMPT } from './api/chat/prompts/prompts';
import { openai } from '@ai-sdk/openai';

const reflectionSchema = z.object({
    tags: z
        .array(z.string())
        .describe(
            "2-4 keywords that would help identify similar future conversations. Use field-specific terms like 'deep_learning', 'methodology_question', 'results_interpretation'",
        ),
    summary: z
        .string()
        .describe(
            'One sentence describing what the conversation accomplished',
        ),
    whatWorkedWell: z
        .string()
        .describe(
            'Most effective approach or strategy used in this conversation',
        ),
    whatToAvoid: z
        .string()
        .describe(
            'Most important pitfall or ineffective approach to avoid',
        ),
});

export const reflectOnChat = async (chatId: string) => {
    const chat = await getChat(chatId);

    if (!chat) {
        throw new Error(`Chat with ID ${chatId} not found`);
    }

    // Call LLM to generate structured reflection
    const result = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: reflectionSchema,
        system: REFLECT_ON_CHAT_SYSTEM_PROMPT,
        prompt: chatToText(chat),
        output: "object"
    });

    console.log('Reflect on chat result:', result.object);

    // Persist the reflection to the database
    await updateChatLLMSummary(chat.id, result.object);
};