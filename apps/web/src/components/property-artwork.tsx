import Image from "next/image";
import { artworkForPropertyType } from "@/lib/property-artwork";

export function PropertyArtwork({ propertyType }: { propertyType: string | null }) {
  const artwork = artworkForPropertyType(propertyType);
  return <figure className="property-artwork">
    <Image src={artwork.src} alt={artwork.alt} width={960} height={960} loading="eager" sizes="(max-width: 1000px) 280px, 320px" />
    <figcaption><strong>{artwork.title}</strong><span>Illustrative — not this property, a measured model or survey evidence.</span>{artwork.src.endsWith("rural-land.webp") ? <span>No title boundaries or geology are inferred.</span> : null}</figcaption>
  </figure>;
}
