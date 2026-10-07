import {initialRouteName} from './RootNavigator';
import {ROUTES} from './routes';

jest.mock('@amazon-devices/react-navigation__stack', () => ({createStackNavigator: () => ({Navigator: 'Navigator', Screen: 'Screen'})}));
jest.mock('./AppShellNavigator', () => ({AppShellNavigator: 'AppShellNavigator', APP_SHELL_ROUTE: 'AppShell'}));
jest.mock('../screens/LinkScreen', () => ({LinkScreen: 'LinkScreen'}));
jest.mock('../screens/ProfilesScreen', () => ({ProfilesScreen: 'ProfilesScreen'}));

describe('initialRouteName', () => {
  afterEach(() => {
    delete (globalThis as {localStorage?: Storage}).localStorage;
  });

  function storeWith(entries: Record<string, string>): void {
    const map = new Map(Object.entries(entries));
    (globalThis as {localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>}).localStorage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
  }

  it('pairs a device that holds no session', () => {
    storeWith({});
    expect(initialRouteName()).toBe(ROUTES.link);
  });

  it('opens the profile picker on a device that is already signed in', () => {
    storeWith({'playarr:session': JSON.stringify({accessToken: 'a', refreshToken: 'r', tokenType: 'Bearer', expiresAt: 1})});
    expect(initialRouteName()).toBe(ROUTES.profiles);
  });
});
