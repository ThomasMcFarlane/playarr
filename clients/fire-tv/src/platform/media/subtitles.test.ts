import {downloadSubtitleToLocalFile, type SubtitleFileSystem} from './subtitles';

function fakeFileSystem(): {fs: SubtitleFileSystem; writes: Array<{path: string; content: string; encoding: string}>} {
  const writes: Array<{path: string; content: string; encoding: string}> = [];
  return {
    writes,
    fs: {
      writeStringToFile: async (path: string, content: string, encoding: string) => {
        writes.push({path, content, encoding});
        return content.length;
      },
    },
  };
}

describe('downloadSubtitleToLocalFile', () => {
  it('fetches the VTT with a bearer token, writes it under /data, and returns a file:// path', async () => {
    const {fs, writes} = fakeFileSystem();
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://example.test/subs/en.vtt');
      expect(init?.headers).toEqual({Authorization: 'Bearer token-123'});
      return {ok: true, text: async () => 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello'} as Response;
    });

    const localPath = await downloadSubtitleToLocalFile(
      {id: 'sub-1', url: 'https://example.test/subs/en.vtt', label: 'English', language: 'en'},
      {getAccessToken: () => 'token-123', fetchImpl: fetchImpl as unknown as typeof fetch, fileSystem: fs}
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(localPath).toBe('file:///data/playarr-subtitle-sub-1.vtt');
    expect(writes).toEqual([
      {
        path: '/data/playarr-subtitle-sub-1.vtt',
        content: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello',
        encoding: 'UTF-8',
      },
    ]);
  });

  it('sanitises a track id that is not filesystem-safe', async () => {
    const {fs, writes} = fakeFileSystem();
    const fetchImpl = async () => ({ok: true, text: async () => 'WEBVTT'}) as Response;

    const localPath = await downloadSubtitleToLocalFile(
      {id: '../../etc/passwd', url: 'https://example.test/x.vtt', label: 'X'},
      {getAccessToken: () => 'token', fetchImpl: fetchImpl as unknown as typeof fetch, fileSystem: fs}
    );

    expect(localPath).toBe('file:///data/playarr-subtitle-______etc_passwd.vtt');
    expect(writes[0]?.path).toBe('/data/playarr-subtitle-______etc_passwd.vtt');
  });

  it('throws with the HTTP status when the download fails', async () => {
    const {fs} = fakeFileSystem();
    const fetchImpl = async () => ({ok: false, status: 403, text: async () => ''}) as Response;

    await expect(
      downloadSubtitleToLocalFile(
        {id: 'sub-1', url: 'https://example.test/x.vtt', label: 'X'},
        {getAccessToken: () => 'token', fetchImpl: fetchImpl as unknown as typeof fetch, fileSystem: fs}
      )
    ).rejects.toThrow('403');
  });

  it('leaves the request unauthenticated (no header at all) when no token is available', async () => {
    const {fs} = fakeFileSystem();
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toEqual({});
      return {ok: true, text: async () => 'WEBVTT'} as Response;
    });

    await downloadSubtitleToLocalFile(
      {id: 'sub-1', url: 'https://example.test/x.vtt', label: 'X'},
      {getAccessToken: () => undefined, fetchImpl: fetchImpl as unknown as typeof fetch, fileSystem: fs}
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
