import {useContext, useEffect, useState} from 'react';
import {NavigationContext} from '@amazon-devices/react-navigation__native';

/**
 * Whether this screen is the one on top. Screens under it stay mounted and keep their remote-key handlers, so a
 * handler checks this first. Outside a navigator (unit tests) a screen counts as on top.
 */
export function useOnTop(): boolean {
  const navigation = useContext(NavigationContext);
  const [onTop, setOnTop] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) return undefined;
    const focus = navigation.addListener('focus', () => setOnTop(true));
    const blur = navigation.addListener('blur', () => setOnTop(false));
    return () => {
      focus();
      blur();
    };
  }, [navigation]);
  return onTop;
}
