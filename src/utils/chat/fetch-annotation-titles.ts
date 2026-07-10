import { Annotation } from '../../types/llm/response'
import { fetchUrlTitle, isPublicHttpUrl } from '../fetch-utils'

const MAX_TITLE_FETCHES_PER_BATCH = 5
const MAX_CACHED_TITLES = 100

// global cache for URL titles
const urlTitleCache = new Map<
  string,
  | { status: 'pending' }
  | { status: 'fetched'; title: string | null }
  | { status: 'error' }
>()

// Fetches the titles of the URLs in the annotations
export function fetchAnnotationTitles(
  annotations: Annotation[],
  onFetchUrlTitle: (url: string, title: string | null) => void,
) {
  annotations
    .filter(
      (annotation) =>
        annotation.type === 'url_citation' &&
        !annotation.url_citation.title &&
        isPublicHttpUrl(annotation.url_citation.url),
    )
    .slice(0, MAX_TITLE_FETCHES_PER_BATCH)
    .forEach((annotation) => {
      const url = annotation.url_citation.url
      if (urlTitleCache.has(url)) {
        const cached = urlTitleCache.get(url)
        if (cached?.status === 'fetched') {
          annotation.url_citation.title = cached.title ?? undefined
        }
      } else if (urlTitleCache.size < MAX_CACHED_TITLES) {
        urlTitleCache.set(url, { status: 'pending' })
        fetchUrlTitle(url)
          .then((title) => {
            urlTitleCache.set(url, { status: 'fetched', title })
            onFetchUrlTitle(url, title)
          })
          .catch(() => {
            urlTitleCache.set(url, { status: 'error' })
          })
      }
    })
}
