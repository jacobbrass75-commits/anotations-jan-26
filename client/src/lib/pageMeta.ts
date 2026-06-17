export function updatePageMeta(title: string, description: string) {
  const previousTitle = document.title;
  let descriptionMeta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const createdDescription = !descriptionMeta;
  const previousDescription = descriptionMeta?.getAttribute("content") ?? "";

  if (!descriptionMeta) {
    descriptionMeta = document.createElement("meta");
    descriptionMeta.name = "description";
    document.head.appendChild(descriptionMeta);
  }

  document.title = title;
  descriptionMeta.setAttribute("content", description);

  return () => {
    document.title = previousTitle;
    if (createdDescription) {
      descriptionMeta?.remove();
      return;
    }
    descriptionMeta?.setAttribute("content", previousDescription);
  };
}

export function mountJsonLd(data: unknown) {
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.text = JSON.stringify(data);
  document.head.appendChild(script);

  return () => {
    script.remove();
  };
}
