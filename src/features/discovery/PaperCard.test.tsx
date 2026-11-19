import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import { PaperCard } from './PaperCard'
import { makePaper } from './testFixtures'

afterEach(cleanup)

test('displays paper metadata and links the title to its details', () => {
  const paper = makePaper()
  render(<MemoryRouter><PaperCard paper={paper} /></MemoryRouter>)

  expect(screen.getByRole('link', { name: paper.title }).getAttribute('href')).toBe('/papers/W123')
  for (const text of ['Alice Chen, Bob Lee', '2024-05-10', 'Computer Science', paper.abstract!]) {
    expect(screen.getByText(text)).toBeTruthy()
  }
})

test('handles missing metadata and falls back from publication date to year', () => {
  const paper = makePaper({ authors: [], publicationDate: null, abstract: null, researchArea: null })
  const { rerender } = render(<MemoryRouter><PaperCard paper={paper} /></MemoryRouter>)

  for (const text of ['Authors unavailable', '2024', 'Research area unavailable', 'Abstract unavailable']) {
    expect(screen.getByText(text)).toBeTruthy()
  }
  rerender(<MemoryRouter><PaperCard paper={{ ...paper, year: null }} /></MemoryRouter>)
  expect(screen.getByText('Publication date unavailable')).toBeTruthy()
  expect(screen.getByRole('link', { name: paper.title }).getAttribute('href')).toBe('/papers/W123')
})
