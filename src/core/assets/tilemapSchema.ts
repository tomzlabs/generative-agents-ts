import { z } from 'zod';

// Tiled supports both external TSX references ("source") and embedded tilesets ("image", ...)
export const TiledTilesetSchema = z
  .object({
    firstgid: z.number().int(),
    source: z.string().optional(),
    name: z.string().optional(),
    image: z.string().optional(),
    imagewidth: z.number().int().optional(),
    imageheight: z.number().int().optional(),
    tilewidth: z.number().int().optional(),
    tileheight: z.number().int().optional(),
    tilecount: z.number().int().optional(),
    columns: z.number().int().optional(),
  })
  .passthrough();

export const TiledLayerSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  visible: z.boolean().optional(),
  opacity: z.number().optional(),

  width: z.number().int().optional(),
  height: z.number().int().optional(),

  x: z.number().optional(),
  y: z.number().optional(),

  data: z.array(z.number().int()).optional(),
});

export const TiledMapSchema = z.object({
  type: z.literal('map').optional(),
  version: z.union([z.number(), z.string()]).optional(),
  tiledversion: z.union([z.number(), z.string()]).optional(),

  width: z.number().int(),
  height: z.number().int(),
  tilewidth: z.number().int(),
  tileheight: z.number().int(),

  infinite: z.boolean().optional(),
  orientation: z.string().optional(),
  renderorder: z.string().optional(),

  layers: z.array(TiledLayerSchema),
  tilesets: z.array(TiledTilesetSchema).optional(),
});

export type TiledMap = z.infer<typeof TiledMapSchema>;
