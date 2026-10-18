// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '../src/shared/ui/render-root.ts';
import { useAppThemeDark } from '../src/app/providers/useAppThemeDark.ts';
import { saveMediaTheme } from '../src/features/media/services/theme.ts';

const root = document.createElement('div');
document.body.append(root);
function Probe({ scope }: { scope: string }) { return <span data-dark={String(useAppThemeDark(scope))} />; }
const dark = () => root.querySelector('span')!.getAttribute('data-dark');

afterEach(() => { act(() => render(null, root)); localStorage.clear(); });

describe('useAppThemeDark', () => {
  it('follows the chosen theme live, so Mantine switches scheme with the app', () => {
    saveMediaTheme('dark-test', 'sand');
    act(() => render(<Probe scope="dark-test" />, root));
    expect(dark()).toBe('false');
    act(() => { saveMediaTheme('dark-test', 'midnight'); });
    expect(dark()).toBe('true');
    act(() => { saveMediaTheme('dark-test', 'ocean'); });
    expect(dark()).toBe('false');
  });
});
