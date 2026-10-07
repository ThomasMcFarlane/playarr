import {APP_CONFIG, DEFAULT_HOSTED_LINK_ORIGIN} from './appConfig';

describe('APP_CONFIG.hostedLinkOrigin', () => {
  it('defaults to the production origin when the build sets nothing', () => {
    expect(DEFAULT_HOSTED_LINK_ORIGIN).toBe('https://playarr.app');
    expect(APP_CONFIG.hostedLinkOrigin).toBe(process.env.PLAYARR_HOSTED_LINK_ORIGIN || DEFAULT_HOSTED_LINK_ORIGIN);
  });
});
