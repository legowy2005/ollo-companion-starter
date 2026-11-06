import { useEffect, useRef } from 'react';
import type { Mood } from './mood';
import './mascot.css';

/**
 * The OllO mascot.
 *
 * Geometry comes straight from the supplied mascot art (500x500 PNGs): every eye is four rounded bars
 * plus a pill-shaped pupil, with two vertical bars in the middle and optional eyebrows.
 * Because the face is built from separate bars, we can animate lids, pupils and brows individually.
 * All motion runs in one requestAnimationFrame loop that writes SVG attributes directly,
 * so React never re-renders while ollo is moving.
 */

interface Pose {
  /** how far the top lid is lowered (px in svg units) */
  lidTop: number;
  /** how far the bottom lid is raised */
  lidBottom: number;
  /** pupil size multiplier */
  pupil: number;
  /** 0..1 brow visibility */
  brow: number;
  browLeftY: number;
  browRightY: number;
  browLeftRot: number;
  browRightRot: number;
  /** 0..1 cross-fade from normal eyes to smiling ^ ^ eyes */
  smile: number;
  /** 0..1 sparkles */
  sparkle: number;
  floatAmp: number;
  floatPeriod: number;
  tilt: number;
  /** constant head tilt in degrees (negative = chin up) */
  baseTilt: number;
  offsetY: number;
  jitter: number;
  hop: number;
  /** average seconds between hops */
  hopGap: number;
  /** where the eyes like to rest (-1..1) */
  gazeX: number;
  gazeY: number;
  gazeWander: number;
  blinkMin: number;
  blinkMax: number;
}

const POSES: Record<Mood, Pose> = {
  neutral: { lidTop: 0, lidBottom: 0, pupil: 1, brow: 0, browLeftY: 12, browRightY: 12, browLeftRot: 0, browRightRot: 0, smile: 0, sparkle: 0, floatAmp: 6, floatPeriod: 3.8, tilt: 1.6, baseTilt: 0, offsetY: 0, jitter: 0, hop: 0, hopGap: 4.3, gazeX: 0, gazeY: 0, gazeWander: 0.9, blinkMin: 2.2, blinkMax: 5.5 },
  happy: { lidTop: 0, lidBottom: 0, pupil: 1, brow: 0, browLeftY: 12, browRightY: 12, browLeftRot: 0, browRightRot: 0, smile: 1, sparkle: 0, floatAmp: 9, floatPeriod: 2.6, tilt: 2.6, baseTilt: 0, offsetY: -2, jitter: 0, hop: 1, hopGap: 4.3, gazeX: 0, gazeY: 0, gazeWander: 0.9, blinkMin: 3, blinkMax: 6 },
  // wide open eyes, high brows, quick little hops
  excited: { lidTop: -5, lidBottom: -3, pupil: 1.2, brow: 1, browLeftY: -13, browRightY: -13, browLeftRot: 0, browRightRot: 0, smile: 0, sparkle: 0.75, floatAmp: 10, floatPeriod: 1.7, tilt: 3.2, baseTilt: 0, offsetY: -4, jitter: 0, hop: 1.5, hopGap: 2.1, gazeX: 0, gazeY: -0.1, gazeWander: 0.9, blinkMin: 3, blinkMax: 6 },
  proud: { lidTop: 12, lidBottom: 4, pupil: 1, brow: 1, browLeftY: -9, browRightY: -9, browLeftRot: -3, browRightRot: 3, smile: 0, sparkle: 1, floatAmp: 6, floatPeriod: 4.4, tilt: 1.2, baseTilt: -4, offsetY: -5, jitter: 0, hop: 0, hopGap: 4.3, gazeX: 0.45, gazeY: -0.7, gazeWander: 0.25, blinkMin: 3.5, blinkMax: 7 },
  // smug: half-lidded side-eye, one brow up and the other slanted down
  cocky: { lidTop: 11, lidBottom: 3, pupil: 0.95, brow: 1, browLeftY: -11, browRightY: 4, browLeftRot: -5, browRightRot: -13, smile: 0, sparkle: 0, floatAmp: 5, floatPeriod: 4, tilt: 2.2, baseTilt: 4, offsetY: -2, jitter: 0, hop: 0, hopGap: 4.3, gazeX: -0.85, gazeY: 0.1, gazeWander: 0.12, blinkMin: 3.5, blinkMax: 7 },
  sad: { lidTop: 7, lidBottom: 0, pupil: 1, brow: 1, browLeftY: 2, browRightY: 2, browLeftRot: -15, browRightRot: 15, smile: 0, sparkle: 0, floatAmp: 3, floatPeriod: 5.6, tilt: 0.8, baseTilt: 0, offsetY: 7, jitter: 0, hop: 0, hopGap: 4.3, gazeX: -0.2, gazeY: 0.85, gazeWander: 0.3, blinkMin: 2, blinkMax: 4.5 },
  angry: { lidTop: 5, lidBottom: 0, pupil: 0.82, brow: 1, browLeftY: 0, browRightY: 0, browLeftRot: 19, browRightRot: -17, smile: 0, sparkle: 0, floatAmp: 3.2, floatPeriod: 1.9, tilt: 0.6, baseTilt: 0, offsetY: 0, jitter: 1, hop: 0, hopGap: 4.3, gazeX: 0, gazeY: 0.15, gazeWander: 0.12, blinkMin: 4.5, blinkMax: 8 }
};

// Measured from the mascot PNGs.
const EYES = [
  { cx: 157, left: 122.5, right: 191, topX1: 133.5, topX2: 179.5, pupilX: 147 },
  { cx: 332, left: 297.5, right: 366, topX1: 308.5, topX2: 354.5, pupilX: 320.5 }
] as const;
const TOP_Y = 210.5;
const BOTTOM_Y = 301.5;
const SIDE_TOP = 221.5;
const SIDE_BOTTOM = 290.5;
const MID_Y = (TOP_Y + BOTTOM_Y) / 2;
const PUPIL_Y1 = 255;
const PUPIL_Y2 = 280;
const PUPIL_REST_Y = 267.5;
const STROKE = 11;
const PUPIL_W = 16;
const FACE_CX = 245;
const FACE_CY = 256;
const BROW_X = [165, 328.5];
const BROW_Y = 172;

const SPARKLES = [
  { x: 402, y: 150, size: 1, phase: 0 },
  { x: 86, y: 168, size: 0.7, phase: 2.1 },
  { x: 414, y: 238, size: 0.55, phase: 4.2 }
];
const SPARKLE_PATH = 'M0 -10 L2.6 -2.6 L10 0 L2.6 2.6 L0 10 L-2.6 2.6 L-10 0 L-2.6 -2.6Z';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

interface Props {
  mood: Mood;
  className?: string;
  /** Plays the pop-in entrance. Default true. */
  pop?: boolean;
  label?: string;
}

export function Mascot({ mood, className = '', pop = true, label }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const moodRef = useRef<Mood>(mood);
  const reactRef = useRef<(strength: number) => void>(() => {});
  const firstMood = useRef(true);

  useEffect(() => {
    moodRef.current = mood;
    if (firstMood.current) { firstMood.current = false; return; }
    reactRef.current(1);
  }, [mood]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const q = <T extends Element>(selector: string) => svg.querySelector<T>(selector)!;
    const qa = <T extends Element>(selector: string) => [...svg.querySelectorAll<T>(selector)];

    const body = q<SVGGElement>('[data-part=body]');
    const tops = qa<SVGLineElement>('[data-part=top]');
    const bottoms = qa<SVGLineElement>('[data-part=bottom]');
    const lefts = qa<SVGLineElement>('[data-part=side-left]');
    const rights = qa<SVGLineElement>('[data-part=side-right]');
    const pupils = qa<SVGLineElement>('[data-part=pupil]');
    const eyeGroups = qa<SVGGElement>('[data-part=eye]');
    const smileGroups = qa<SVGGElement>('[data-part=smile]');
    const brows = qa<SVGGElement>('[data-part=brow]');
    const sparkles = qa<SVGPathElement>('[data-part=sparkle]');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Animated values. Each one eases toward the target pose.
    const cur = { ...POSES[moodRef.current] };
    let gx = 0, gy = 0;               // current gaze
    let tgx = 0, tgy = 0;             // target gaze
    let blink = 0;                    // 0 open .. 1 closed
    let blinkUntil = 0;
    let nextBlink = rand(1.2, 3);
    let nextWander = 0.9;
    let lastPointer = -99;
    let pointerGx = 0, pointerGy = 0;
    let spring = 0, springV = 0;      // squash & stretch for taps and mood changes
    let nextHop = 3.2;
    let hopStart = -99;
    let shakeUntil = 0;
    let nextShake = rand(1.5, 3.5);
    let startT = -1;
    let last = 0;
    let raf = 0;
    const popDelay = 0.08;

    reactRef.current = (strength: number) => {
      springV += 7 * strength;
      blinkUntil = performance.now() / 1000 + 0.12;
      if (moodRef.current === 'angry') shakeUntil = performance.now() / 1000 + 0.7;
    };

    function onPointerMove(event: PointerEvent) {
      const rect = svg!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      pointerGx = clamp((event.clientX - cx) / (window.innerWidth * 0.45), -1, 1);
      pointerGy = clamp((event.clientY - cy) / (window.innerHeight * 0.45), -1, 1);
      lastPointer = performance.now() / 1000;
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerMove, { passive: true });

    function frame(ms: number) {
      const t = ms / 1000;
      if (startT < 0) { startT = t; last = t; }
      const dt = Math.min(0.05, t - last);
      last = t;
      const age = t - startT;
      const target = POSES[moodRef.current];

      // ---- ease numeric pose values toward the target mood
      const rate = reduced ? 60 : 7;
      for (const key of Object.keys(target) as (keyof Pose)[]) {
        cur[key] += (target[key] - cur[key]) * ease(rate, dt);
      }

      // ---- blink
      if (t >= nextBlink) {
        blinkUntil = t + 0.11;
        nextBlink = t + rand(target.blinkMin, target.blinkMax);
        if (Math.random() < 0.22) nextBlink = t + 0.28; // quick double blink
      }
      const blinkTarget = t < blinkUntil ? 1 : 0;
      blink += (blinkTarget - blink) * ease(blinkTarget ? 55 : 28, dt);

      // ---- gaze: follow the pointer when it was recently used, otherwise glance around
      if (t - lastPointer < 3.2) {
        tgx = pointerGx; tgy = pointerGy;
      } else if (!reduced && t >= nextWander) {
        const w = target.gazeWander;
        tgx = clamp(target.gazeX + rand(-1, 1) * w, -1, 1);
        tgy = clamp(target.gazeY + rand(-1, 1) * w * 0.8, -1, 1);
        nextWander = t + rand(1.1, 3.4);
      } else if (reduced) {
        tgx = target.gazeX; tgy = target.gazeY;
      }
      gx += (tgx - gx) * ease(14, dt);
      gy += (tgy - gy) * ease(14, dt);

      // ---- spring for squash & stretch
      springV += (-90 * spring - 9 * springV) * dt;
      spring += springV * dt;

      // ---- body motion
      let dx = 0, dy = cur.offsetY, rot = 0, sx = 1, sy = 1;
      if (!reduced) {
        const w = (Math.PI * 2) / cur.floatPeriod;
        dy += Math.sin(t * w) * cur.floatAmp;
        dx += Math.sin(t * w * 0.5 + 1) * 2.5;
        rot += Math.sin(t * w * 0.7) * cur.tilt;
        // happy hop
        if (cur.hop > 0.05) {
          if (t >= nextHop) { hopStart = t; nextHop = t + rand(cur.hopGap * 0.75, cur.hopGap * 1.3); }
          const p = (t - hopStart) / 0.55;
          if (p >= 0 && p <= 1) {
            const arc = Math.sin(Math.PI * p);
            dy -= 18 * arc * cur.hop;
            sy += 0.07 * arc * cur.hop;
            sx -= 0.04 * arc * cur.hop;
          }
        }
        // angry trembling
        if (cur.jitter > 0.05) {
          if (t >= nextShake) { shakeUntil = t + rand(0.5, 0.9); nextShake = t + rand(2.4, 4.5); }
        }
        if (t < shakeUntil) dx += Math.sin(t * 95) * 2.2 * Math.max(cur.jitter, 0.4);
      }
      rot += cur.baseTilt;
      sy += spring * 0.12;
      sx -= spring * 0.08;

      // ---- pop in
      let opacity = 1;
      if (pop) {
        const pt = Math.max(0, age - popDelay);
        if (reduced) {
          opacity = clamp(pt / 0.25, 0, 1);
        } else {
          opacity = clamp(pt / 0.14, 0, 1);
          const s = 1 - Math.exp(-5.5 * pt) * Math.cos(13 * pt) * 0.75;
          const lift = Math.exp(-5 * pt) * 46;
          sx *= s; sy *= s; dy += lift;
        }
      }

      body.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) translate(${FACE_CX} ${FACE_CY}) rotate(${rot.toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${-FACE_CX} ${-FACE_CY})`);
      svg!.style.opacity = String(opacity);

      // ---- eyes
      const half = (TOP_Y - MID_Y) * -1; // 45.5
      const topShift = cur.lidTop + (half - cur.lidTop) * blink;
      const botShift = cur.lidBottom + (half - cur.lidBottom) * blink;
      const topY = TOP_Y + topShift;
      const botY = BOTTOM_Y - botShift;
      let sideTop = SIDE_TOP + topShift;
      let sideBot = SIDE_BOTTOM - botShift;
      if (sideBot < sideTop) { const mid = (sideTop + sideBot) / 2; sideTop = mid; sideBot = mid; }

      const eyeOpacity = 1 - cur.smile;
      eyeGroups.forEach((g) => g.setAttribute('opacity', eyeOpacity.toFixed(3)));
      smileGroups.forEach((g) => g.setAttribute('opacity', cur.smile.toFixed(3)));

      tops.forEach((el) => { el.setAttribute('y1', topY.toFixed(2)); el.setAttribute('y2', topY.toFixed(2)); });
      bottoms.forEach((el) => { el.setAttribute('y1', botY.toFixed(2)); el.setAttribute('y2', botY.toFixed(2)); });
      [...lefts, ...rights].forEach((el) => { el.setAttribute('y1', sideTop.toFixed(2)); el.setAttribute('y2', sideBot.toFixed(2)); });

      // pupils: gaze mapped inside the eye frame, kept clear of the lids
      const dxPupil = -12 + ((gx + 1) / 2) * 36;
      const rawDy = -24 + ((gy + 1) / 2) * 28;
      const ps = cur.pupil;
      const halfH = (12.5 * ps) * (1 - blink) + (PUPIL_W * ps) / 2;
      const minC = topY + STROKE / 2 + 3 + halfH;
      const maxC = botY - STROKE / 2 - 3 - halfH;
      const centerY = clamp(PUPIL_REST_Y + rawDy, Math.min(minC, maxC), Math.max(minC, maxC));
      const halfLen = 12.5 * ps * (1 - blink);
      pupils.forEach((el, i) => {
        const x = EYES[i].pupilX + dxPupil;
        el.setAttribute('x1', x.toFixed(2)); el.setAttribute('x2', x.toFixed(2));
        el.setAttribute('y1', (centerY - halfLen).toFixed(2));
        el.setAttribute('y2', (centerY + halfLen).toFixed(2));
        el.setAttribute('stroke-width', (PUPIL_W * ps).toFixed(2));
        el.setAttribute('opacity', clamp(1 - blink * 1.3, 0, 1).toFixed(3));
      });

      // ---- brows
      brows.forEach((el, i) => {
        const rotB = i === 0 ? cur.browLeftRot : cur.browRightRot;
        const y = BROW_Y + (i === 0 ? cur.browLeftY : cur.browRightY);
        el.setAttribute('transform', `translate(${BROW_X[i]} ${y.toFixed(2)}) rotate(${rotB.toFixed(2)})`);
        el.setAttribute('opacity', clamp(cur.brow, 0, 1).toFixed(3));
      });

      // ---- sparkles
      sparkles.forEach((el, i) => {
        const s = SPARKLES[i];
        const pulse = Math.max(0, Math.sin(t * 2.2 + s.phase));
        const size = s.size * cur.sparkle * (0.35 + pulse * 0.9) * 2.4;
        el.setAttribute('transform', `translate(${s.x} ${s.y}) rotate(${(t * 25 + s.phase * 40).toFixed(1)}) scale(${size.toFixed(3)})`);
        el.setAttribute('opacity', clamp(cur.sparkle * (0.3 + pulse * 0.7), 0, 1).toFixed(3));
      });

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerMove);
    };
  }, [pop]);

  const spoken = label ?? `OllO looks ${mood === 'neutral' ? 'calm' : mood}`;

  return (
    <svg
      ref={svgRef}
      className={`ollo-mascot ${className}`}
      viewBox="60 100 380 240"
      role="img"
      aria-label={spoken}
      style={{ opacity: pop ? 0 : 1 }}
      onPointerDown={() => reactRef.current(0.8)}
    >
      <g data-part="body" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        {EYES.map((eye, i) => (
          <g key={i}>
            <g data-part="eye">
              <line data-part="top" x1={eye.topX1} x2={eye.topX2} y1={TOP_Y} y2={TOP_Y} />
              <line data-part="bottom" x1={eye.topX1} x2={eye.topX2} y1={BOTTOM_Y} y2={BOTTOM_Y} />
              <line data-part="side-left" x1={eye.left} x2={eye.left} y1={SIDE_TOP} y2={SIDE_BOTTOM} />
              <line data-part="side-right" x1={eye.right} x2={eye.right} y1={SIDE_TOP} y2={SIDE_BOTTOM} />
              <line data-part="pupil" x1={eye.pupilX} x2={eye.pupilX} y1={PUPIL_Y1} y2={PUPIL_Y2} strokeWidth={PUPIL_W} />
            </g>
            <g data-part="smile" opacity={0}>
              <polyline points={`${eye.cx - 26} ${FACE_CY + 16} ${eye.cx} ${FACE_CY - 16} ${eye.cx + 26} ${FACE_CY + 16}`} />
            </g>
          </g>
        ))}
        <line x1={226.5} x2={226.5} y1={209.5} y2={301.5} />
        <line x1={262} x2={262} y1={209.5} y2={301.5} />
        {[0, 1].map((i) => (
          <g key={i} data-part="brow" opacity={0}>
            <line x1={-25} x2={25} y1={0} y2={0} />
          </g>
        ))}
      </g>
      {SPARKLES.map((_, i) => <path key={i} data-part="sparkle" d={SPARKLE_PATH} fill="currentColor" stroke="none" opacity={0} />)}
    </svg>
  );
}
