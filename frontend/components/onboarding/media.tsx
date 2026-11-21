import type React from 'react';

function isExternalMediaSource(
  src: React.MediaHTMLAttributes<HTMLMediaElement>['src'],
) {
  return typeof src === 'string' && /^https?:\/\//i.test(src);
}

type VideoProps = React.VideoHTMLAttributes<HTMLVideoElement>;
type AudioProps = React.AudioHTMLAttributes<HTMLAudioElement>;

function getCrossOriginValue(
  src: React.MediaHTMLAttributes<HTMLMediaElement>['src'],
  crossOrigin: React.MediaHTMLAttributes<HTMLMediaElement>['crossOrigin'],
) {
  if (crossOrigin !== undefined) {
    return crossOrigin;
  }

  return isExternalMediaSource(src) ? 'anonymous' : undefined;
}

export function OnboardingVideo({ crossOrigin, src, ...props }: VideoProps) {
  return (
    <video crossOrigin={getCrossOriginValue(src, crossOrigin)} src={src} {...props} />
  );
}

export function OnboardingAudio({ crossOrigin, src, ...props }: AudioProps) {
  return (
    <audio crossOrigin={getCrossOriginValue(src, crossOrigin)} src={src} {...props} />
  );
}
