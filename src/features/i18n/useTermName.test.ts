import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSettings } from '../settings/settingsStore'
import i18n from '.'
import { useTermName } from './useTermName'

describe('useTermName', () => {
  afterEach(async () => {
    // both inside `act`: the hook is still mounted here, so either one re-renders it
    await act(async () => {
      await i18n.changeLanguage('en')
      useSettings.getState().setTranslatedTerms(true)
    })
  })

  it('names a yaku in the reader’s language, or in Japanese with translated terms off', () => {
    const { result } = renderHook(() => useTermName())
    expect(result.current('yaku', 'chinitsu')).toBe('Full flush')
    act(() => useSettings.getState().setTranslatedTerms(false))
    expect(result.current('yaku', 'chinitsu')).toBe('Chinitsu')
  })

  it.each([
    ['ja', '清一色'],
    ['zh', '清一色'],
  ])('falls back to %s’s own term, never to en’s translated one', async (lng, expected) => {
    // translated terms stay on (the default): ja/zh hide the setting, and carry no translated
    // block, so the Japanese key in their own locale is the answer
    const { result } = renderHook(() => useTermName())
    await act(() => i18n.changeLanguage(lng))
    expect(result.current('yaku', 'chinitsu')).toBe(expected)
  })
})
