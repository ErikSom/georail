import { h } from 'preact';
import type { ComponentChildren } from 'preact';

// Define the props, which will be the content passed from Astro
interface LayoutProps {
  children: ComponentChildren;
}

/**
 * This is a Preact component to wrap the 2D UI content.
 * It renders the <main> tag with the foreground styles.
 */
function Layout({ children }: LayoutProps) {
  return (
    <main className="foreground-content">
      {children}
    </main>
  );
}

export default Layout;