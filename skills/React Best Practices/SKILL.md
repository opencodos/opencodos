---
name: react-best-practices
description: Performance optimization for React/Next.js. Use when building components, fixing perf issues, or reviewing code.
---

# React Best Practices

> Performance optimization guide for React and Next.js (57 rules, 8 categories).

## Trigger

`/react` or "optimize this React code" or "review for performance"

## Rule Categories (by Priority)

### 1. CRITICAL: Eliminating Waterfalls

**Defer awaits into branches where needed:**
```typescript
// BAD: Sequential
const user = await getUser();
const posts = await getPosts();

// GOOD: Parallel
const [user, posts] = await Promise.all([
  getUser(),
  getPosts()
]);
```

**Start promises early, await late:**
```typescript
// BAD
export async function GET() {
  const data = await fetchData();
  return Response.json(data);
}

// GOOD
export async function GET() {
  const dataPromise = fetchData(); // Start immediately
  // ... other setup
  const data = await dataPromise; // Await when needed
  return Response.json(data);
}
```

**Use Suspense for streaming:**
```tsx
<Suspense fallback={<Skeleton />}>
  <SlowComponent />
</Suspense>
```

### 2. CRITICAL: Bundle Size

**Import directly, not through barrel files:**
```typescript
// BAD
import { Button } from '@/components';

// GOOD
import { Button } from '@/components/Button';
```

**Dynamic imports for heavy components:**
```typescript
import dynamic from 'next/dynamic';

const HeavyChart = dynamic(() => import('./Chart'), {
  loading: () => <Skeleton />,
  ssr: false
});
```

**Defer third-party code:**
```typescript
// Load after hydration
useEffect(() => {
  import('heavy-library').then(lib => {
    // use lib
  });
}, []);
```

**Preload on interaction hints:**
```tsx
<Link
  href="/dashboard"
  onMouseEnter={() => prefetch('/dashboard')}
>
  Dashboard
</Link>
```

### 3. HIGH: Server-Side Performance

**Use React.cache() for request deduplication:**
```typescript
import { cache } from 'react';

export const getUser = cache(async (id: string) => {
  return db.user.findUnique({ where: { id } });
});
```

**Authenticate server actions:**
```typescript
'use server';

export async function updateProfile(data: FormData) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');
  // ...
}
```

**Minimize prop serialization in RSC:**
```tsx
// BAD: Passing entire object
<ClientComponent data={hugeObject} />

// GOOD: Pass only what's needed
<ClientComponent id={hugeObject.id} name={hugeObject.name} />
```

**Use after() for non-blocking operations:**
```typescript
import { after } from 'next/server';

export async function POST(req: Request) {
  const result = await processRequest(req);

  after(async () => {
    await logAnalytics(result);
    await sendNotification(result);
  });

  return Response.json(result);
}
```

### 4. MEDIUM-HIGH: Client Data Fetching

**Use SWR for deduplication:**
```typescript
import useSWR from 'swr';

function Profile() {
  const { data, error, isLoading } = useSWR('/api/user', fetcher);
  // Automatic caching, revalidation, deduplication
}
```

**Passive event listeners for scroll:**
```typescript
element.addEventListener('scroll', handler, { passive: true });
```

**Version localStorage data:**
```typescript
const CACHE_VERSION = 'v2';
const key = `${CACHE_VERSION}:user-prefs`;
localStorage.setItem(key, JSON.stringify(compressed));
```

### 5. MEDIUM: Re-render Optimization

**Don't subscribe to state only used in callbacks:**
```typescript
// BAD
const count = useStore(state => state.count);
const onClick = () => api.track(count);

// GOOD
const onClick = () => api.track(useStore.getState().count);
```

**Use primitive dependencies in effects:**
```typescript
// BAD
useEffect(() => {}, [user]);

// GOOD
useEffect(() => {}, [user.id]);
```

**Derive computed values during render:**
```typescript
// BAD
const [items, setItems] = useState([]);
const [filteredItems, setFilteredItems] = useState([]);

useEffect(() => {
  setFilteredItems(items.filter(x => x.active));
}, [items]);

// GOOD
const [items, setItems] = useState([]);
const filteredItems = useMemo(
  () => items.filter(x => x.active),
  [items]
);
```

**Lazy initialization for expensive state:**
```typescript
// BAD
const [data] = useState(expensiveComputation());

// GOOD
const [data] = useState(() => expensiveComputation());
```

**Use transitions for non-urgent updates:**
```typescript
const [isPending, startTransition] = useTransition();

const handleChange = (value) => {
  startTransition(() => {
    setSearchResults(filterResults(value));
  });
};
```

### 6. MEDIUM: Rendering Performance

**Use content-visibility for long lists:**
```css
.list-item {
  content-visibility: auto;
  contain-intrinsic-size: 0 50px;
}
```

**Extract static JSX outside components:**
```tsx
// BAD
function Component() {
  return <div><StaticIcon /><Dynamic /></div>;
}

// GOOD
const staticIcon = <StaticIcon />;
function Component() {
  return <div>{staticIcon}<Dynamic /></div>;
}
```

**Use ternary instead of && for conditionals:**
```tsx
// BAD (can render 0 or false)
{count && <Badge count={count} />}

// GOOD
{count ? <Badge count={count} /> : null}
```

### 7. LOW-MEDIUM: JavaScript Performance

**Build Maps for repeated lookups:**
```typescript
// BAD
items.forEach(item => {
  const user = users.find(u => u.id === item.userId);
});

// GOOD
const userMap = new Map(users.map(u => [u.id, u]));
items.forEach(item => {
  const user = userMap.get(item.userId);
});
```

**Combine filter/map into single iteration:**
```typescript
// BAD
const result = items.filter(x => x.active).map(x => x.name);

// GOOD
const result = items.reduce((acc, x) => {
  if (x.active) acc.push(x.name);
  return acc;
}, []);
```

**Use Set for O(1) lookups:**
```typescript
// BAD
const exists = array.includes(item);

// GOOD
const set = new Set(array);
const exists = set.has(item);
```

## Quick Reference

| Priority | Category | Key Rule |
|----------|----------|----------|
| CRITICAL | Waterfalls | Promise.all() for parallel fetches |
| CRITICAL | Bundle | Direct imports, dynamic() for heavy |
| HIGH | Server | React.cache(), after() |
| MEDIUM-HIGH | Client | SWR, passive listeners |
| MEDIUM | Re-renders | Primitive deps, derived state |
| MEDIUM | Rendering | content-visibility, static extraction |
| LOW-MEDIUM | JS | Map/Set for lookups |

## When to Apply

- Writing new components
- Implementing data fetching
- Reviewing performance issues
- Refactoring existing code
- Optimizing bundle/load times

## Source

Based on Vercel Labs' agent-skills (57 rules).
