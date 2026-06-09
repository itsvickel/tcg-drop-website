import { useRouter } from "next/router";
import ProductDetailPage from "../../components/ProductDetailPage";

export default function PokemonProductPage() {
  const router = useRouter();
  const groupKey = typeof router.query.group_key === "string" ? router.query.group_key : "";
  return <ProductDetailPage tcg="pokemon" groupKey={groupKey} />;
}
