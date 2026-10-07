/** The household-blocked page: the web's copy for an out-of-schedule profile, and the guardian request. */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import type {ApiClient, HouseholdStatus} from '@playarr-tv/api-client';
import {LanguageProvider} from '../i18n/LanguageProvider';
import {HouseholdBlockedScreen} from './HouseholdBlockedScreen';

(globalThis as unknown as {React: typeof React}).React = React;

function allText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map((node) => {
      const children = node.props.children;
      return (Array.isArray(children) ? children : [children]).filter((value) => typeof value === 'string').join('');
    })
    .join(' | ');
}

const outsideSchedule = {state: 'outside_schedule', next_start_at: null} as unknown as HouseholdStatus;

describe('HouseholdBlockedScreen', () => {
  it('explains the block and offers both actions', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <LanguageProvider>
          <HouseholdBlockedScreen client={{} as ApiClient} status={outsideSchedule} onSwitchProfile={jest.fn()} />
        </LanguageProvider>,
      );
    });
    const text = allText(renderer);
    expect(text).toContain('Not available right now');
    expect(text).toContain("This profile can't watch at this time.");
    expect(text).toContain('Ask a guardian for more time');
    expect(text).toContain('Switch profile');
  });

  it('asks a guardian for time and says so', async () => {
    const createHouseholdApproval = jest.fn().mockResolvedValue({});
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <LanguageProvider>
          <HouseholdBlockedScreen client={{createHouseholdApproval} as unknown as ApiClient} status={outsideSchedule} onSwitchProfile={jest.fn()} />
        </LanguageProvider>,
      );
    });
    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: 'Ask a guardian for more time'}).props.onPress();
    });
    expect(createHouseholdApproval).toHaveBeenCalledWith({kind: 'time', subject: 'schedule'});
    expect(allText(renderer)).toContain('Request sent.');
  });
});
