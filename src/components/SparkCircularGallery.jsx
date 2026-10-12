import React from 'react';
import CircularGallery from './CircularGallery';
import './CircularGallery.css';

export default function SparkCircularGallery({ items, onItemClick }) {
  return (
    <div className="spark-circular-gallery-container" style={{ position: 'relative' }}>
      <CircularGallery
        bend={3}
        textColor="#ffffff"
        borderRadius={0.05}
        scrollEase={0.05}
        items={items}
        onItemClick={onItemClick}
      />
    </div>
  );
}
