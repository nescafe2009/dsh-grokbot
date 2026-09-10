/** Small-scale, flat character marks. No remote assets, gradients or shared SVG IDs. */
const colors = ['#06C674', '#15BBAE', '#A679F5', '#FF50AB', '#FFAE32', '#6488E8', '#BA855B', '#EC7765']
const shapes = [
  'M8 33C8 23 15 17 25 17h15c11 0 17 6 17 16s-7 16-18 16H24C14 49 8 43 8 33Z',
  'M54 31c4 14-4 24-19 25C20 57 9 48 9 34 8 19 17 8 31 9c13 0 20 9 23 22Z',
  'M17 20c0-8 11-12 17-5 8-5 18 2 17 11 10 7 7 20-3 23-5 8-16 9-23 4-12 3-20-5-18-14-2-8 2-15 10-19Z',
  'M25 11c3-5 10-5 13 1l19 34c3 6 0 10-7 10H14c-7 0-10-5-7-11Z',
  'M16 13h30c7 0 11 5 11 12v21c0 7-5 11-12 11H19C10 57 7 51 7 43V25c0-7 3-12 9-12Z',
  'M9 28C12 13 27 7 41 12c14 4 21 17 15 30-5 13-21 17-35 11C9 48 5 39 9 28Z',
]
const roles: Record<string, [number, number]> = {
  chief:[0,0], coder:[1,2], researcher:[4,1], writer:[3,0], analyst:[5,4],
  pm:[7,3], ops:[6,3], translator:[1,5], secretary:[3,1], reviewer:[2,1],
  blank:[5,0], 'kw-shield':[5,4], 'kw-scales':[6,3], 'kw-book':[0,4],
  'kw-gear':[1,2], 'kw-note':[3,0], 'kw-flame':[7,2],
}
export function identityMark(role: string | undefined, identity: string): string {
  let hash = 2166136261
  for (const ch of identity.normalize('NFC')) hash = Math.imul(hash ^ ch.codePointAt(0)!, 16777619) >>> 0
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507) >>> 0
  hash = (hash ^ (hash >>> 13)) >>> 0
  const [color, shape] = (role !== 'blank' ? roles[role || ''] : undefined) || [hash % colors.length || 2, (hash >>> 8) % shapes.length]
  const eyes = shape === 3 ? 'M27 34l2 5m10-5 2 5' : 'M27 28l2 5m10-5 2 5'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="${shapes[shape]}" fill="${colors[color]}"/><path d="${eyes}" fill="none" stroke="white" stroke-width="4.5" stroke-linecap="round"/></svg>`
}
