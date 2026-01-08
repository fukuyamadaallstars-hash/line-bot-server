-- Hybrid Search Function using Reciprocal Rank Fusion (RRF)
-- Combines pgvector (approximate nearest neighbor) and full-text search (keyword matching)

-- 1. Enable extensions if not already enabled (cannot always do this in function, but good to note)
-- create extension if not exists vector;
-- create extension if not exists pg_trgm; -- for potentially better fuzzy, but here we use tsvector

-- 2. Create the hybrid search function
create or replace function match_knowledge_hybrid (
  query_text text,
  query_embedding vector(1536),
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
    select id, rank() over (order by embedding <=> query_embedding) as rank_vec
    from knowledge_base
    where tenant_id = p_tenant_id
    order by embedding <=> query_embedding
    limit match_count * 2
  ),
  keyword_search as (
    -- Simple Full Text Search using Japanese configuration if available, else 'simple'
    -- Note: 'japanese' config requires proper extension setup usually, or use 'simple' for safer fallback
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
           -- RRF formula: 1 / (k + rank)
           coalesce(1.0 / (60 + v.rank_vec), 0.0) + coalesce(1.0 / (60 + k.rank_kw), 0.0) as rrf_score
    from vector_search v
    full outer join keyword_search k on v.id = k.id
  ) scores on kb.id = scores.id
  order by scores.rrf_score desc
  limit match_count;
end;
$$;
