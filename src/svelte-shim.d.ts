// Lets plain `tsc` (which cannot read .svelte files) type-check imports of Svelte components.
declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<any, any, any>;
  export default component;
}
