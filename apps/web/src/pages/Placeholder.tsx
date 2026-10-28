import { Button } from '@arco-design/web-react';

// 仅用于验证 React + Tailwind + Arco 是否正常工作，页面设计确认后删除
export default function Placeholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-slate-50">
      <h1 className="text-2xl font-semibold text-slate-800">Movehome</h1>
      <p className="text-slate-500">前端骨架已就绪</p>
      <Button type="primary">Arco Button</Button>
    </div>
  );
}
