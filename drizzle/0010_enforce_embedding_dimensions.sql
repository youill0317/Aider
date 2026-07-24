DELETE FROM "embeddings"
WHERE ("path", "model") IN (
  SELECT "path", "model"
  FROM "embeddings"
  WHERE "embedding" IS NOT NULL
    AND vector_dims("embedding") <> "dimension"
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_embedding_dimension_check" CHECK ("embeddings"."embedding" IS NULL OR vector_dims("embeddings"."embedding") = "embeddings"."dimension");
