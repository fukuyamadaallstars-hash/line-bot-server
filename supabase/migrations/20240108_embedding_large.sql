-- 1. Add embedding_model to tenants table
alter table tenants add column if not exists embedding_model text default 'text-embedding-3-small';

-- 2. Add embedding_large column to knowledge_base table (3072 dimensions)
alter table knowledge_base add column if not exists embedding_large vector(3072);

-- 3. Create index for large embeddings
create index if not exists knowledge_base_embedding_large_idx on knowledge_base using hnsw (embedding_large vector_cosine_ops);

-- 4. Create Hybrid Search Function for Large Embeddings (3072 dims)
create or replace function match_knowledge_hybrid_large (
  query_text text,
  query_embedding vector(3072),
  match_threshold float,
  match_count int,
  p_tenant_id uuid
)
returns setof knowledge_base
language plpgsql
as $$
begin
  return query
  with vector_search as (
    select id, rank() over (order by embedding_large <=> query_embedding) as rank_vec
    from knowledge_base
    where tenant_id = p_tenant_id
    and embedding_large is not null -- Ensure we only match rows compatible with large model
    order by embedding_large <=> query_embedding
    limit match_count * 2
  ),
  keyword_search as (
    -- Keyword search remains matched against content, same as standard hybrid
    select id, rank() over (order by ts_rank_cd(to_tsvector('simple', content), plainto_tsquery('simple', query_text)) desc) as rank_kw
    from knowledge_base
    where tenant_id = p_tenant_id
    and to_tsvector('simple', content) @@ plainto_tsquery('simple', query_text)
    limit match_count * 2
  )
  select kb.*
  from knowledge_base kb
  join (
    select coalesce(v.id, k.id) as id,
           coalesce(1.0 / (60 + v.rank_vec), 0.0) + coalesce(1.0 / (60 + k.rank_kw), 0.0) as rrf_score
    from vector_search v
    full outer join keyword_search k on v.id = k.id
  ) scores on kb.id = scores.id
  order by scores.rrf_score desc
  limit match_count;
end;
$$;
