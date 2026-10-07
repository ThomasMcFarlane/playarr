/** A route that has no web-parity screen yet: a bare stage so the shell chrome can be checked. */
import React from 'react';
import {Stage} from '../tv/Stage';

export function PlaceholderScreen(): React.ReactElement {
  return <Stage />;
}
