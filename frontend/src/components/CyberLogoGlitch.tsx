/**
 * CyberLogoGlitch
 * ---------------
 * Animated hacker/cyberpunk logo: acid-green wordmark with a near-continuous
 * RGB-split slice glitch + broken-neon flicker, plus a thin line-art gamepad
 * icon with matching pulse/flicker. Transparent background — drop it on
 * whatever backdrop your site has.
 *
 * Tamanho: controlado pela custom property CSS --size (px), nao por um prop
 * direto — assim quem usa o componente (ver .library-logo/.login-logo em
 * styles.css) consegue deixar responsivo com clamp()/vw sem precisar de
 * JS pra medir a tela. O prop "size" so' define o --size PADRAO (usado se
 * nada sobrescrever via CSS).
 *
 * Usage:
 *   <CyberLogoGlitch text="FLASHGAMES" className="library-logo" />
 */

interface CyberLogoGlitchProps {
  /** Wordmark text */
  text?: string;
  /** Base font-size in px (scales the icon and underline with it) */
  size?: number;
  /** Extra className for the root element */
  className?: string;
}

export default function CyberLogoGlitch({ text = "FLASHGAMES", size = 64, className = "" }: CyberLogoGlitchProps) {
  return (
    <div className={`cl-root${className ? ` ${className}` : ""}`} style={{ ["--size" as string]: `${size}px` }}>
      <div className="cl-icon">
        <svg className="cl-icon-glow" viewBox="0 0 120 90" width="calc(var(--size) * 1.15)" height="calc(var(--size) * 0.86)">
          <defs>
            <linearGradient id="cl-pad-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22d3ff" />
              <stop offset="45%" stopColor="#b24bff" />
              <stop offset="100%" stopColor="#ff3bd4" />
            </linearGradient>
          </defs>
          {/* angular, cut-corner line-art gamepad */}
          <polygon
            points="26,34 40,34 40,20 66,20 66,10 90,10 96,16 96,26 106,26 112,32 112,58 106,64 100,64 96,58 84,58 78,50 62,50 56,58 44,58 40,64 32,64 26,58 26,44"
            fill="none"
            stroke="url(#cl-pad-grad)"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          {/* d-pad */}
          <g className="cl-icon-dpad" stroke="url(#cl-pad-grad)" strokeWidth="2.4" strokeLinecap="square">
            <line x1="46" y1="30" x2="46" y2="44" />
            <line x1="39" y1="37" x2="53" y2="37" />
          </g>
          {/* action buttons */}
          <circle className="cl-icon-btn b1" cx="86" cy="30" r="3.6" fill="#3aa8ff" />
          <circle className="cl-icon-btn b2" cx="98" cy="40" r="3.6" fill="#ff3bd4" />
        </svg>
      </div>

      <div className="cl-wordwrap">
        <h1 className="cl-word" data-text={text}>
          <span>{text}</span>
        </h1>
        <div className="cl-underline">
          <span className="cl-underline-bar" />
        </div>
      </div>
    </div>
  );
}
