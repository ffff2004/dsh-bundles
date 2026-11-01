import { z } from 'zod'
import { extractZoteroLinks } from './links.js'

export const projectionKey = 'localZoteroSelect'
const linkSchema = z.object({ uri: z.string(), title: z.string(), itemKey: z.string() })
const stateSchema = z.record(z.string(), z.array(linkSchema))

/** Durable messages only; the framework owns replay, caching, and publication. */
export const projection = {
  key: projectionKey,
  stateVersion: 1,
  stateSchema,
  init: () => ({}),
  apply(state, event) {
    if (event.type !== 'assistant/message' || event.data.interrupted) return state
    const { message } = event.data
    // Match the host's concatenation of visible text blocks, not reasoning.
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const links = extractZoteroLinks(text)
    if (links.length === 0) return state
    return { ...state, [message.id]: links }
  },
  wire: { viewSchema: stateSchema, view: state => state },
}
