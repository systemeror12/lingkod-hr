import { StateCode, StateSurface } from '../../components/state-surface';

export default function Loading() {
  return (
    <StateSurface label="Loading workspace" busy>
      <StateCode>Loading</StateCode>
      <div className="h-[10px] w-[min(380px,70vw)] rounded-sm bg-pale-blue" />
      <div className="h-[10px] w-[min(230px,50vw)] rounded-sm bg-pale-blue" />
    </StateSurface>
  );
}
