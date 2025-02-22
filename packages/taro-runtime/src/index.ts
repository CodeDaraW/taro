import './polyfill/reflect-metadata'
export { TaroNode } from './dom/node'
export { TaroText } from './dom/text'
export { TaroElement } from './dom/element'
export { TaroRootElement } from './dom/root'
export { FormElement } from './dom/form'
export { TaroEvent, createEvent } from './dom/event'
export { createDocument, document } from './bom/document'
export { window } from './bom/window'
export { navigator } from './bom/navigator'
export { default as container } from './container'
export { default as processPluginHooks } from './container/plugin-hooks'
export { default as SERVICE_IDENTIFIER } from './constants/identifiers'
export { connectReactPage, createReactApp, createNativeComponentConfig } from './dsl/react'
export { connectVuePage, createVueApp } from './dsl/vue'
export { createVue3App } from './dsl/vue3'
export * from './dsl/instance'
export { createPageConfig, injectPageInstance, createComponentConfig, createRecursiveComponentConfig, stringify } from './dsl/common'
export { Current, getCurrentInstance } from './current'
export { Style } from './dom/style'
export * from './dsl/hooks'
export { options } from './options'
export { nextTick } from './next-tick'
export { hydrate } from './hydrate'
export * from './emitter/emitter'
export { raf as requestAnimationFrame, caf as cancelAnimationFrame, now } from './bom/raf'
export { getComputedStyle } from './bom/getComputedStyle'
export * from './interface'
