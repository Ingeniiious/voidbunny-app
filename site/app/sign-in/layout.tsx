import type { ReactNode } from "react";

// Locks html + body to the dynamic viewport while the user is on /sign-in
// so iOS Safari's URL-bar gap can't open a scroll underneath the card.
// The root layout uses min-h-screen (100vh) which is taller than 100dvh on
// mobile — without this scope-style, the page hangs ~50–100px below the
// fold and rubber-bands when the user touches it.
//
// The <style> is rendered server-side and removed automatically when the
// user navigates off /sign-in, so the constraint doesn't leak.

export default function SignInLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <>
      <style>{`
        html, body {
          overflow: hidden;
          height: 100dvh;
          overscroll-behavior: none;
        }
      `}</style>
      {children}
    </>
  );
}
