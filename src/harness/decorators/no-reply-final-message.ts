import type { OutputHandler } from '../../types.js';

/**
 * NoReplyCheckHandler - Dead simple handler wrapper.
 * 
 * Wraps an OutputHandler and intercepts relay() calls.
 * If the message contains 'NO_REPLY', swallows it.
 * Otherwise passes it through to the wrapped handler.
 * 
 * Use with streamMode: 'final' so only the final message matters.
 */
export function withNoReplyCheck(handler: OutputHandler | null): OutputHandler | null {
  if (!handler) return null;
  
  return {
    relay: async (message: string) => {
      if (message.includes('NO_REPLY')) {
        console.log('[NoReplyCheck] Response contained NO_REPLY, suppressing output');
        return;
      }
      await handler.relay(message);
    },
    relayEvent: handler.relayEvent?.bind(handler),
    startTyping: handler.startTyping?.bind(handler),
    stopTyping: handler.stopTyping?.bind(handler),
    endMessage: handler.endMessage?.bind(handler),
    startReaction: handler.startReaction?.bind(handler),
    stopReaction: handler.stopReaction?.bind(handler),
  };
}
