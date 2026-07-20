import React from 'react';

export default function TabSkeleton() {
  return (
    <div className="tab-skeleton">
      <div className="skeleton-row">
        <div className="skeleton skeleton-card-sm" />
        <div className="skeleton skeleton-card-sm" />
        <div className="skeleton skeleton-card-sm" />
      </div>
      <div className="skeleton skeleton-card-tall" />
      <div className="skeleton-row skeleton-row-2">
        <div className="skeleton skeleton-card-mid" />
        <div className="skeleton skeleton-card-mid" />
      </div>
    </div>
  );
}
