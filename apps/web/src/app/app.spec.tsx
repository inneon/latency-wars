import { render, screen } from '@testing-library/react';
import App from './app';

const jsonResponse = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

describe('App', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports healthy when the API says so', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ status: 'healthy', checkedAt: 'now' })));
    render(<App />);
    expect(await screen.findByText('healthy')).toBeTruthy();
    expect(screen.getByRole('heading').textContent).toBe('Hello, API is healthy');
  });

  it('reports unhealthy when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    render(<App />);
    expect(await screen.findByText('unhealthy')).toBeTruthy();
  });
});
