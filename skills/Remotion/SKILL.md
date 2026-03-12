---
name: remotion-best-practices
description: Best practices for Remotion - Video creation in React
---

# Remotion Best Practices

> Create videos programmatically with React using Remotion.

## Trigger

`/remotion` or "create video with Remotion" or "animate this"

---

## AI-Assisted Workflow (Jonny Burger Method)

> Based on how Remotion's creator works with Claude Code.

### Prompting Patterns

| Pattern | Example | Why It Works |
|---------|---------|--------------|
| **One change at a time** | "remove the background" → "make font bigger" | Easier to validate each step |
| **Casual visual language** | "a lot bigger", "grayish", "more punchy" | Lets AI interpret, faster iteration |
| **Extract components early** | "refactor cursor into its own file" | Clean code from the start |
| **Animation endpoints** | "rotate Y from 20 to -20 degrees" | Clear input/output for interpolate |
| **Scope timing** | "over total length" or "in first 30 frames" | Anchors animation to frame count |
| **Progressive enhancement** | Build layout → add animation → refine | Each step verifiable |
| **Run and observe** | "run the command, look at output" | Ground content in reality |

### Workflow

```
1. Describe the WHAT, not the HOW
   Bad:  "use interpolate with frame 0-30 mapping to opacity 0-1"
   Good: "fade in over the first second"

2. Build incrementally
   - "make a terminal window, light theme"
   - [preview]
   - "font needs to be bigger"
   - [preview]
   - "add typewriter animation"

3. Extract as you go
   - "put the cursor in its own component"
   - "move the animation logic to a hook"

4. Describe motion intuitively
   - "flip towards the camera"
   - "bounce in from the left"
   - "slowly rotate over the whole video"

5. Iterate based on preview
   - "too fast, slow it down"
   - "needs more bounce"
   - "delay this until after the title appears"
```

### Example Session

```
You: "scene 1: chrome browser with 5 tabs showing apps with notification badges"
AI:  [builds basic structure]
You: [preview] "tabs should shake slightly, feels too static"
AI:  [adds subtle shake animation]
You: "badges need to be red and more visible"
AI:  [adjusts badge styling]
You: "add title text at bottom, fade in after tabs settle"
AI:  [adds title with delayed fade]
```

---

## Quick Reference

| Task | Pattern |
|------|---------|
| Basic animation | `useCurrentFrame()` + `interpolate()` |
| Sequencing | `<Series>` or `<Sequence>` |
| Media | `<Video>`, `<Audio>`, `<Img>` |
| Timing | `useVideoConfig()` for fps/duration |
| 3D content | React Three Fiber |
| Captions | Word-by-word highlighting |

## Project Setup

```bash
npx create-video@latest my-video
cd my-video
npm start
```

## Basic Animation

```tsx
import { useCurrentFrame, interpolate, Easing } from 'remotion';

export const FadeIn: React.FC = () => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, 30],      // Input range (frames)
    [0, 1],       // Output range
    { extrapolateRight: 'clamp' }
  );

  const scale = interpolate(
    frame,
    [0, 30],
    [0.8, 1],
    {
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.ease)
    }
  );

  return (
    <div style={{ opacity, transform: `scale(${scale})` }}>
      Hello World
    </div>
  );
};
```

## Composition Setup

```tsx
import { Composition } from 'remotion';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MyVideo"
        component={MyVideo}
        durationInFrames={150}  // 5 seconds at 30fps
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
```

## Sequencing Scenes

### Using Series
```tsx
import { Series } from 'remotion';

export const MyVideo: React.FC = () => {
  return (
    <Series>
      <Series.Sequence durationInFrames={60}>
        <Intro />
      </Series.Sequence>
      <Series.Sequence durationInFrames={90}>
        <MainContent />
      </Series.Sequence>
      <Series.Sequence durationInFrames={30}>
        <Outro />
      </Series.Sequence>
    </Series>
  );
};
```

### Using Sequence
```tsx
import { Sequence } from 'remotion';

export const MyVideo: React.FC = () => {
  return (
    <>
      <Sequence from={0} durationInFrames={60}>
        <Intro />
      </Sequence>
      <Sequence from={60} durationInFrames={90}>
        <MainContent />
      </Sequence>
    </>
  );
};
```

## Media Handling

### Images
```tsx
import { Img, staticFile } from 'remotion';

<Img src={staticFile('logo.png')} />
```

### Video
```tsx
import { Video, OffthreadVideo } from 'remotion';

// Standard (in main thread)
<Video src={staticFile('clip.mp4')} />

// Better performance (offthread)
<OffthreadVideo src={staticFile('clip.mp4')} />

// With trimming and volume
<OffthreadVideo
  src={staticFile('clip.mp4')}
  startFrom={30}           // Start at frame 30
  endAt={150}              // End at frame 150
  volume={0.5}             // 50% volume
  playbackRate={1.5}       // 1.5x speed
/>
```

### Audio
```tsx
import { Audio } from 'remotion';

<Audio
  src={staticFile('music.mp3')}
  volume={(f) => interpolate(f, [0, 30], [0, 1])}  // Fade in
/>
```

### Fonts
```tsx
import { loadFont } from '@remotion/fonts';

const { fontFamily } = loadFont({
  fontFamily: 'Inter',
  url: staticFile('Inter-Regular.woff2'),
});

<div style={{ fontFamily }}>Text</div>
```

## Text Animation

```tsx
import { useCurrentFrame, interpolate, spring } from 'remotion';

export const AnimatedText: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{ display: 'flex' }}>
      {text.split('').map((char, i) => {
        const delay = i * 2;
        const scale = spring({
          frame: frame - delay,
          fps,
          config: { damping: 200 }
        });

        return (
          <span
            key={i}
            style={{
              transform: `scale(${scale})`,
              display: 'inline-block'
            }}
          >
            {char === ' ' ? '\u00A0' : char}
          </span>
        );
      })}
    </div>
  );
};
```

## Spring Animation

```tsx
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

const MyComponent = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: {
      damping: 10,      // Lower = more bouncy
      stiffness: 100,   // Higher = faster
      mass: 1,          // Higher = slower
    }
  });

  return <div style={{ transform: `scale(${scale})` }} />;
};
```

## Captions with Word Highlighting

```tsx
import { useCurrentFrame } from 'remotion';

interface Word {
  text: string;
  start: number;  // Frame
  end: number;
}

export const Captions: React.FC<{ words: Word[] }> = ({ words }) => {
  const frame = useCurrentFrame();

  return (
    <div>
      {words.map((word, i) => {
        const isActive = frame >= word.start && frame < word.end;
        return (
          <span
            key={i}
            style={{
              color: isActive ? '#FFD700' : '#FFFFFF',
              fontWeight: isActive ? 'bold' : 'normal',
            }}
          >
            {word.text}{' '}
          </span>
        );
      })}
    </div>
  );
};
```

## 3D with React Three Fiber

```tsx
import { ThreeCanvas } from '@remotion/three';
import { useCurrentFrame } from 'remotion';

export const ThreeDScene: React.FC = () => {
  const frame = useCurrentFrame();
  const rotation = (frame / 60) * Math.PI * 2;

  return (
    <ThreeCanvas>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <mesh rotation={[0, rotation, 0]}>
        <boxGeometry args={[2, 2, 2]} />
        <meshStandardMaterial color="#ff6b6b" />
      </mesh>
    </ThreeCanvas>
  );
};
```

## Dynamic Metadata (Parametrization)

```tsx
import { Composition } from 'remotion';
import { z } from 'zod';

const schema = z.object({
  title: z.string(),
  color: z.string(),
});

export const RemotionRoot = () => {
  return (
    <Composition
      id="DynamicVideo"
      component={DynamicVideo}
      schema={schema}
      defaultProps={{
        title: 'Hello',
        color: '#ff0000',
      }}
      calculateMetadata={async ({ props }) => {
        return {
          durationInFrames: props.title.length * 10,
        };
      }}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
```

## Rendering

```bash
# Preview
npm start

# Render to MP4
npx remotion render MyVideo out.mp4

# Render specific props
npx remotion render MyVideo out.mp4 --props='{"title":"Custom"}'

# Render frames only
npx remotion render MyVideo --frames=0-30
```

## TailwindCSS Integration

```tsx
// tailwind.config.js
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
};

// Component
export const StyledComponent = () => (
  <div className="flex items-center justify-center h-full bg-gradient-to-r from-purple-500 to-pink-500">
    <h1 className="text-6xl font-bold text-white">Hello</h1>
  </div>
);
```

## Installation

```bash
npm install remotion @remotion/cli @remotion/bundler
npm install @remotion/three  # For 3D
npm install @remotion/fonts  # For fonts
```

## Source

Based on remotion-dev/skills (32+ rules) + Jonny Burger's Claude Code workflow.
