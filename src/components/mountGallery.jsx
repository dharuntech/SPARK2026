import React from 'react';
import { createRoot } from 'react-dom/client';
import SparkCircularGallery from './SparkCircularGallery';

let rootInstance = null;

export function mountSparkCircularGallery(container, props) {
  if (!container) return;
  if (!rootInstance) {
    rootInstance = createRoot(container);
  }
  rootInstance.render(
    <SparkCircularGallery
      items={props?.items}
      onItemClick={props?.onItemClick}
    />
  );
}

if (typeof window !== 'undefined') {
  window.mountSparkCircularGallery = mountSparkCircularGallery;
}
