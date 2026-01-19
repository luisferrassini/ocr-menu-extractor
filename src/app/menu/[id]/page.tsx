import MenuViewClient from "./MenuViewClient";

export function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function MenuViewPage() {
  return <MenuViewClient />;
}
