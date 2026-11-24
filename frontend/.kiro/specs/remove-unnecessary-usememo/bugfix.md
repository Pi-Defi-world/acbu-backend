# Bugfix Requirements Document

## Introduction

Across the `acbu-frontend` codebase, `useMemo` is applied to primitive values,
simple array property reads (e.g. `.length`), and lightweight pure calculations
where the cost of memoization (storing the cached value and running a shallow
equality check on every render) exceeds the cost of simply recomputing the
value inline. The issue manifests in approximately 505 call sites. This bugfix
removes those unnecessary `useMemo` wrappers so components no longer pay the
memoization overhead for zero gain, while preserving `useMemo` where it is
legitimately beneficial (expensive computations, referential-stability for
objects/arrays passed as props or used as effect dependencies).

Concrete examples found in the codebase:

- `useMemo(() => sessions.length, [sessions])` — reading `.length` is O(1) and
  returns a primitive; no benefit from caching.
- `useMemo(() => ({}), [])` — creating an empty object literal with a static
  empty dependency array; the object is recreated on every cold-start anyway
  and the hook adds overhead.
- `useMemo(() => localPerAcbu("USD", rates), [rates])` — where `localPerAcbu`
  is a trivial lookup/arithmetic helper that costs far less than the
  memoization bookkeeping.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a component renders and `useMemo` wraps a primitive value (e.g. a
    number, boolean, or string literal), THEN the system incurs memoization
    overhead (value storage + dependency comparison) while providing no
    reduction in computation cost.

1.2 WHEN a component renders and `useMemo` wraps a simple property access
    such as `array.length`, THEN the system performs a dependency array
    comparison on every render even though re-reading `.length` inline is
    faster than the memoization bookkeeping.

1.3 WHEN a component renders and `useMemo` wraps a lightweight pure
    calculation (e.g. a single arithmetic expression or a trivial array
    `.find()`/`.filter()` over a small constant dataset), THEN the system adds
    React internal overhead without any measurable performance benefit.

1.4 WHEN `useMemo(() => ({}), [])` is returned from a hook, THEN the system
    creates a new empty object on every cold-mount and caches it, adding hook
    overhead while the callers gain no referential stability guarantee beyond
    what a module-level constant would provide.

### Expected Behavior (Correct)

2.1 WHEN a component needs a primitive value derived from state or props,
    THEN the system SHALL compute it inline (direct assignment or expression)
    without wrapping it in `useMemo`.

2.2 WHEN a component needs `array.length` or another O(1) property read,
    THEN the system SHALL read the property directly without a `useMemo`
    wrapper.

2.3 WHEN a component needs a lightweight pure calculation whose recomputation
    cost is negligible compared to memoization overhead, THEN the system SHALL
    perform the calculation inline, removing the `useMemo` wrapper.

2.4 WHEN a hook returns a static empty options object with no changing
    dependencies, THEN the system SHALL return a module-level or inline
    constant directly, without `useMemo`.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a component uses `useMemo` to wrap a computation that returns a
    **non-primitive** (object, array, function) that is passed as a prop or
    used as a dependency in `useEffect`/`useCallback`, THEN the system SHALL
    CONTINUE TO keep the `useMemo` wrapper to preserve referential stability.

3.2 WHEN a component uses `useMemo` for a **computationally expensive**
    operation (e.g. sorting or filtering a large dataset, building a complex
    derived data structure), THEN the system SHALL CONTINUE TO keep the
    `useMemo` wrapper to avoid unnecessary re-computation.

3.3 WHEN a component uses `useMemo` to wrap a **context value object** (e.g.
    the value passed to a React context `Provider`), THEN the system SHALL
    CONTINUE TO keep the `useMemo` wrapper, as referential stability prevents
    unnecessary re-renders of all context consumers.

3.4 WHEN `useMemo` is used to memoize a **JSX subtree** or a list of rendered
    elements that is expensive to reconcile, THEN the system SHALL CONTINUE TO
    keep the `useMemo` wrapper.

3.5 WHEN any component that previously used an unnecessary `useMemo` is
    rendered, THEN the system SHALL CONTINUE TO produce the same rendered
    output and observable behavior as before the change.

---

## Bug Condition Pseudocode

**Bug Condition Function** — identifies `useMemo` calls that are unnecessary:

```pascal
FUNCTION isBugCondition(memoCall)
  INPUT: memoCall — a useMemo call site with factory function F and deps array D
  OUTPUT: boolean

  // The memo is unnecessary when ALL of the following hold:
  isPrimitive    ← returnType(F) ∈ { number, string, boolean, null, undefined }
  isSimpleRead   ← F is a single property access (e.g. arr.length, obj.prop)
  isTrivialCalc  ← F is a pure expression with O(1) or near-O(1) cost AND
                   the result is NOT used as a prop, effect dep, or callback dep
                   requiring referential stability
  isStaticObject ← D = [] AND F returns a new empty/trivially-structured object
                   with no external references

  RETURN isPrimitive OR isSimpleRead OR isTrivialCalc OR isStaticObject
END FUNCTION
```

**Fix Checking Property:**

```pascal
// Property: for all buggy useMemo sites, the fix removes the wrapper
FOR ALL memoCall WHERE isBugCondition(memoCall) DO
  result ← inlineEquivalent(memoCall)   // compute the value directly
  ASSERT result = memoCall.cachedValue  // same value produced
  ASSERT hookCallCount DECREASED BY 1  // one fewer useMemo call per render
END FOR
```

**Preservation Property:**

```pascal
// Property: non-buggy useMemo calls are untouched
FOR ALL memoCall WHERE NOT isBugCondition(memoCall) DO
  ASSERT memoCall UNCHANGED
  ASSERT referentialStability(memoCall) PRESERVED
END FOR
```
