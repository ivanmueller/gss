import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_STORAGE_KEY, readDemoData, setDemoData, useDemoData } from './demo';

afterEach(() => {
  vi.restoreAllMocks();
  setDemoData(false);
  window.localStorage.clear();
});

describe('demo data', () => {
  it('is off until someone turns it on', () => {
    expect(readDemoData()).toBe(false);
    expect(renderHook(() => useDemoData()).result.current[0]).toBe(false);
  });

  it('is kept in this browser when turned on, and forgotten when turned off', () => {
    const { result } = renderHook(() => useDemoData());
    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBe('on');

    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });

  it('follows a change made in another tab', () => {
    const { result } = renderHook(() => useDemoData());
    act(() => {
      window.localStorage.setItem(DEMO_STORAGE_KEY, 'on');
      window.dispatchEvent(new StorageEvent('storage', { key: DEMO_STORAGE_KEY }));
    });
    expect(result.current[0]).toBe(true);

    act(() => {
      window.localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(result.current[0]).toBe(false);
  });

  it('still switches for the session when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readDemoData()).toBe(false);
    const { result } = renderHook(() => useDemoData());
    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
  });
});
