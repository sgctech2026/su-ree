repo: lucide-icons/lucide
branch: main
path: icons

Note: this project's product code is the attached local folder "Su-ree Website"
(a Lovable/TanStack Start app), not a GitHub repo. The repo above is only the
source of the exact icon geometry used in the recreation (the app imports
lucide-react).

## Last sync

date: 2026-09-11T01:58:46Z

### Updated in this project

- Recreated the su-ree homepage as `Home.dc.html` from the local codebase.
- Recreated Shop, Product and Verify screens (Shop.dc.html, Product.dc.html, Verify.dc.html).
- Copied exact lucide path data for dna, atom, waves, sparkle, plus,
  chevron-down, image, search, shopping-bag, target, sparkles,
  shield-check, heart and crown icons.
- Reworked the hero (video background, product renders) and the nav into a
  centered floating pill bar.

## Screen map

| Screen | Built from |
| --- | --- |
| Shop.dc.html | Su-ree Website/src/routes/shop.tsx, src/config/{cdn,srData}.ts, src/components/ImagePlaceholder.tsx |
| Product.dc.html | Su-ree Website/src/routes/product.$slug.tsx, src/config/{cdn,srData}.ts, src/components/ImagePlaceholder.tsx |
| Verify.dc.html | Su-ree Website/src/routes/verify.index.tsx, src/components/verify/VerifyCodeForm.tsx, src/components/SiteHeader.tsx, src/components/sections/SiteFooter.tsx |
| Home.dc.html | Su-ree Website/src/routes/index.tsx, src/routes/__root.tsx, src/styles.css, src/components/hero/*, src/components/sections/*, src/components/{CdnImage,ImagePlaceholder}.tsx, src/config/{cdn,navLinks,srData}.ts; icons from lucide-icons/lucide@main icons/*.svg |
