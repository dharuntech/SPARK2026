import React from 'react';
import CircularGallery from './CircularGallery';
import './CircularGallery.css';

export default function SparkCircularGallery({ items, onItemClick }) {
  return (
    <div className="spark-circular-gallery-container" style={{ position: 'relative' }}>
      <CircularGallery
        bend={3}
        textColor="#17324a"
        borderRadius={0.06}
        scrollEase={0.05}
        itemAspect={0.52}
        itemSize={1.42}
        shadow={0.16}
        showTitles={false}
        items={items}
        onItemClick={onItemClick}
      />
    </div>
  );
}
