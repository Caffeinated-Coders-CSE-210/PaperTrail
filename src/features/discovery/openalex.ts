import type { Paper, PaperId } from '../../shared/paper'
import type { PaperService, SearchType } from './service'

const OPENALEX_API_URL = 'https://api.openalex.org'

interface OpenAlexLocation {
  landing_page_url?: string | null
  pdf_url?: string | null
}

interface OpenAlexWork {
  id?: string
  title?: string | null
  authorships?: { author?: { display_name?: string | null } | null }[] | null
  publication_year?: number | null
  publication_date?: string | null
  abstract_inverted_index?: Record<string, number[]> | null
  doi?: string | null
  primary_topic?: { field?: { display_name?: string | null } | null } | null
  keywords?: { display_name?: string | null }[] | null
  best_oa_location?: OpenAlexLocation | null
  primary_location?: OpenAlexLocation | null
}

interface OpenAlexSearchResponse {
  results?: OpenAlexWork[]
}

function restoreAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null

  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word
  }
  return words.join(' ') || null
}

export function normalizePaper(work: OpenAlexWork): Paper {
  const id = work.id?.match(/(?:^|\/)(W\d+)$/)?.[1]
  if (!id) throw new Error('OpenAlex returned a paper without a valid work ID')

  return {
    id: id as PaperId,
    title: work.title || 'Untitled paper',
    authors: (work.authorships ?? [])
      .map((authorship) => authorship.author?.display_name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0),
    year: work.publication_year ?? null,
    abstract: restoreAbstract(work.abstract_inverted_index),
    doi: work.doi ?? null,
    url: work.best_oa_location?.landing_page_url
      ?? work.primary_location?.landing_page_url
      ?? work.doi
      ?? null,
    publicationDate: work.publication_date ?? null,
    researchArea: work.primary_topic?.field?.display_name ?? null,
    keywords: (work.keywords ?? [])
      .map((keyword) => keyword.display_name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0),
    pdfUrl: work.best_oa_location?.pdf_url ?? work.primary_location?.pdf_url ?? null,
  }
}

async function fetchOpenAlex(path: string, params = new URLSearchParams()): Promise<Response> {
  const url = new URL(path, OPENALEX_API_URL)
  url.search = params.toString()

  // For local development only: Vite exposes VITE_ variables to the browser
  const apiKey = import.meta.env?.VITE_OPENALEX_API_KEY
  if (apiKey) url.searchParams.set('api_key', apiKey)

  const response = await fetch(url)
  if (response.status === 429) {
    // OpenAlex may include an explanation and a retry delay in its JSON error body
    const lines = ['OpenAlex rate limit reached (HTTP 429).']
    try {
      const body: unknown = await response.json()
      if (body && typeof body === 'object') {
        const details = body as Record<string, unknown>
        if (typeof details.error === 'string') lines.push(`Error: ${details.error}`)
        if (typeof details.message === 'string') lines.push(`Message: ${details.message}`)
        if (typeof details.retryAfter === 'number' && Number.isFinite(details.retryAfter)) {
          lines.push(`Retry after: ${details.retryAfter} seconds`)
        }
      }
    } catch {
      // An empty or non-JSON response should still produce a useful error
    }
    if (lines.length === 1) lines.push('Please try again later.')
    throw new Error(lines.join('\n'))
  }
  if (!response.ok && response.status !== 404) {
    throw new Error(`OpenAlex request failed (${response.status})`)
  }
  return response
}

export async function listDefaultPapers(): Promise<Paper[]> {
  const params = new URLSearchParams({ per_page: '20' })
  const response = await fetchOpenAlex('/works', params)
  const data: OpenAlexSearchResponse = await response.json()
  if (!Array.isArray(data.results)) throw new Error('Unexpected response from OpenAlex')
  return data.results.map(normalizePaper)
}

export const openAlexPaperService: PaperService = {
  async searchPapers(query, searchType: SearchType = 'paper') {
    const text = query.trim()
    if (!text) return []

    const params = new URLSearchParams({ per_page: '20' })
    if (searchType === 'author') {
      const author = text.replace(/"/g, '')
      if (!author.trim()) return []
      params.set('filter', `raw_author_name.search:"${author}"`)
    } else {
      params.set('search', text)
    }

    const response = await fetchOpenAlex('/works', params)
    const data: OpenAlexSearchResponse = await response.json()
    if (!Array.isArray(data.results)) throw new Error('Unexpected response from OpenAlex')
    return data.results.map(normalizePaper)
  },

  async getPaperById(id) {
    const response = await fetchOpenAlex(`/works/${encodeURIComponent(id)}`)
    if (response.status === 404) return null
    const data: OpenAlexWork = await response.json()
    return normalizePaper(data)
  },
}
