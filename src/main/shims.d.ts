declare module 'word-extractor' {
  class WordExtractor {
    extract(path: string | Buffer): Promise<{ getBody(): string }>
  }
  export default WordExtractor
}

