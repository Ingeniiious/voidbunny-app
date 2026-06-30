interface Props {
  src: string;
}

// Stands in for BrowserTab inside the `?mock=1` showcase. Real BrowserTab
// embeds noVNC pointing at a panel-managed Brave instance; in mock mode we
// point a plain iframe at the live marketing site so the in-app browser
// preview is the actual landing-page hero.
export default function MockBrowserTab({ src }: Props) {
  return (
    <div className="absolute inset-0 bg-panel-bg">
      <iframe
        src={src}
        title="Voidbunny — voidbunny.xyz"
        className="w-full h-full border-0"
        loading="eager"
      />
    </div>
  );
}
