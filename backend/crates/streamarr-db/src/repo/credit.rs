//! Storage boundary for [`Person`]/[`Credit`] -- see
//! `streamarr_model::person`'s module doc comment for the full rationale.
//! One trait covers both aggregates, same reasoning as `PlaylistRepo`:
//! they're small, always used together, and split cleanly enough by verb
//! (`*_person` vs `*_for_work`/`*_for_person`) that one trait reads fine.

use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::{Credit, CreditRole, Person};
use uuid::Uuid;

use crate::codec::parse_uuid;
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

#[async_trait]
pub trait CreditRepo: Send + Sync {
    async fn get_person(&self, id: Uuid) -> Result<Person, DbError>;

    /// The dedup lookup every credit sync does first: TMDb's person id is
    /// the one stable identity key across every movie a person appears in
    /// (see `Person::tmdb_id`'s doc comment).
    async fn find_person_by_tmdb_id(&self, tmdb_id: i64) -> Result<Option<Person>, DbError>;

    /// Insert-or-update by `Person::id`.
    async fn upsert_person(&self, person: &Person) -> Result<(), DbError>;

    /// A work's credits, cast and crew together, ordered by
    /// `Credit::order` -- the same billing/department order the source
    /// (Radarr/TMDb) provides. Callers that need cast and crew split
    /// filter this by `Credit::role` rather than the repo offering two
    /// separate methods for what's one indexed query either way.
    async fn list_for_work(&self, work_id: Uuid) -> Result<Vec<Credit>, DbError>;

    /// Every distinct `work_id` this person has a credit on -- the "find
    /// all content for this person" endpoint's backing query. Order is
    /// unspecified here; `streamarr_api::people` sorts the resolved
    /// `Work`s for display.
    async fn list_work_ids_for_person(&self, person_id: Uuid) -> Result<Vec<Uuid>, DbError>;

    /// Replaces every credit on `work_id` with exactly `credits` in one
    /// shot (delete-then-reinsert inside a transaction, same pattern
    /// `WorkRepo::upsert` uses for `work_external_refs`) -- a full
    /// reconciliation each sync pass, not an incremental diff, since the
    /// source (`GET /api/v3/credit?movieId=`) always returns the complete
    /// current cast/crew list anyway.
    async fn replace_credits_for_work(
        &self,
        work_id: Uuid,
        credits: &[Credit],
    ) -> Result<(), DbError>;
}

fn role_kind_of(role: &CreditRole) -> &'static str {
    match role {
        CreditRole::Cast { .. } => "cast",
        CreditRole::Crew { .. } => "crew",
    }
}

pub struct SqlxCreditRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxCreditRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn person_from_row(row: &AnyRow) -> Result<Person, DbError> {
        let id: String = row.try_get("id")?;
        Ok(Person {
            id: parse_uuid(&id)?,
            name: row.try_get("name")?,
            tmdb_id: row.try_get::<Option<i64>, _>("tmdb_id")?,
            headshot_url: row.try_get("headshot_url")?,
        })
    }

    fn credit_from_row(row: &AnyRow) -> Result<Credit, DbError> {
        let id: String = row.try_get("id")?;
        let work_id: String = row.try_get("work_id")?;
        let person_id: String = row.try_get("person_id")?;
        let role_kind: String = row.try_get("role_kind")?;
        let character: Option<String> = row.try_get("character")?;
        let department: Option<String> = row.try_get("department")?;
        let job: Option<String> = row.try_get("job")?;
        let order: i32 = row.try_get("sort_order")?;

        let role = match role_kind.as_str() {
            "crew" => CreditRole::Crew {
                department: department.unwrap_or_default(),
                job: job.unwrap_or_default(),
            },
            // "cast", and anything unrecognized, degrades to cast rather
            // than erroring the whole row out -- same "never fail a read
            // over one bad enum discriminant" convention
            // `codec::work_kind_from_str`'s callers rely on elsewhere.
            _ => CreditRole::Cast {
                character: character.unwrap_or_default(),
            },
        };

        Ok(Credit {
            id: parse_uuid(&id)?,
            work_id: parse_uuid(&work_id)?,
            person_id: parse_uuid(&person_id)?,
            role,
            order,
        })
    }
}

#[async_trait]
impl CreditRepo for SqlxCreditRepo {
    async fn get_person(&self, id: Uuid) -> Result<Person, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "SELECT id, name, tmdb_id, headshot_url FROM people WHERE id = ?",
            Backend::Postgres => "SELECT id, name, tmdb_id, headshot_url FROM people WHERE id = $1",
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DbError::NotFound)?;
        Self::person_from_row(&row)
    }

    async fn find_person_by_tmdb_id(&self, tmdb_id: i64) -> Result<Option<Person>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, name, tmdb_id, headshot_url FROM people WHERE tmdb_id = ?"
            }
            Backend::Postgres => {
                "SELECT id, name, tmdb_id, headshot_url FROM people WHERE tmdb_id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(tmdb_id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::person_from_row).transpose()
    }

    async fn upsert_person(&self, person: &Person) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO people (id, name, tmdb_id, headshot_url) VALUES (?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, tmdb_id = excluded.tmdb_id, headshot_url = excluded.headshot_url"
            }
            Backend::Postgres => {
                "INSERT INTO people (id, name, tmdb_id, headshot_url) VALUES ($1, $2, $3, $4) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, tmdb_id = excluded.tmdb_id, headshot_url = excluded.headshot_url"
            }
        };
        sqlx::query(sql)
            .bind(person.id.to_string())
            .bind(person.name.as_str())
            .bind(person.tmdb_id)
            .bind(person.headshot_url.as_deref())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_for_work(&self, work_id: Uuid) -> Result<Vec<Credit>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, work_id, person_id, role_kind, character, department, job, sort_order \
                 FROM credits WHERE work_id = ? ORDER BY sort_order ASC"
            }
            Backend::Postgres => {
                "SELECT id, work_id, person_id, role_kind, character, department, job, sort_order \
                 FROM credits WHERE work_id = $1 ORDER BY sort_order ASC"
            }
        };
        let rows = sqlx::query(sql)
            .bind(work_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::credit_from_row).collect()
    }

    async fn list_work_ids_for_person(&self, person_id: Uuid) -> Result<Vec<Uuid>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "SELECT DISTINCT work_id FROM credits WHERE person_id = ?",
            Backend::Postgres => "SELECT DISTINCT work_id FROM credits WHERE person_id = $1",
        };
        let rows = sqlx::query(sql)
            .bind(person_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter()
            .map(|row| {
                let work_id: String = row.try_get("work_id")?;
                parse_uuid(&work_id)
            })
            .collect()
    }

    async fn replace_credits_for_work(
        &self,
        work_id: Uuid,
        credits: &[Credit],
    ) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;

        let delete_sql = match self.backend {
            Backend::Sqlite => "DELETE FROM credits WHERE work_id = ?",
            Backend::Postgres => "DELETE FROM credits WHERE work_id = $1",
        };
        sqlx::query(delete_sql)
            .bind(work_id.to_string())
            .execute(&mut *tx)
            .await?;

        let insert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO credits (id, work_id, person_id, role_kind, character, department, job, sort_order) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO credits (id, work_id, person_id, role_kind, character, department, job, sort_order) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
            }
        };
        for credit in credits {
            let (character, department, job) = match &credit.role {
                CreditRole::Cast { character } => (Some(character.as_str()), None, None),
                CreditRole::Crew { department, job } => {
                    (None, Some(department.as_str()), Some(job.as_str()))
                }
            };
            sqlx::query(insert_sql)
                .bind(credit.id.to_string())
                .bind(work_id.to_string())
                .bind(credit.person_id.to_string())
                .bind(role_kind_of(&credit.role))
                .bind(character)
                .bind(department)
                .bind(job)
                .bind(credit.order)
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_person(name: &str, tmdb_id: i64) -> Person {
        Person {
            id: Uuid::new_v4(),
            name: name.to_string(),
            tmdb_id: Some(tmdb_id),
            headshot_url: Some("https://image.tmdb.org/t/p/original/headshot.jpg".to_string()),
        }
    }

    /// `credits.work_id` is a real FK to `works(id)` -- seeds a minimal
    /// row so tests that exercise `replace_credits_for_work`/
    /// `list_work_ids_for_person` don't trip it with an orphan id.
    async fn seed_work(pool: &DbPool, id: Uuid) {
        use crate::repo::work::{SqlxWorkRepo, WorkRepo};
        use streamarr_model::{Availability, Work, WorkKind};

        let repo = SqlxWorkRepo::new(pool.clone());
        repo.upsert(&Work {
            id,
            kind: WorkKind::Movie,
            external_refs: Vec::new(),
            title: "Test Movie".to_string(),
            sort_title: "Test Movie".to_string(),
            overview: None,
            images: Vec::new(),
            genres: Vec::new(),
            tags: Vec::new(),
            added_at: chrono::Utc::now(),
            release_date: None,
            monitored: true,
            availability: Availability::Available,
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn upsert_person_then_find_by_tmdb_id_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxCreditRepo::new(pool);
        let person = sample_person("Mary Elizabeth Winstead", 17628);

        repo.upsert_person(&person).await.unwrap();
        let found = repo.find_person_by_tmdb_id(17628).await.unwrap();
        assert_eq!(found, Some(person.clone()));

        let fetched = repo.get_person(person.id).await.unwrap();
        assert_eq!(fetched, person);
    }

    #[tokio::test]
    async fn find_person_by_tmdb_id_misses_when_unknown() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxCreditRepo::new(pool);
        let found = repo.find_person_by_tmdb_id(999_999).await.unwrap();
        assert_eq!(found, None);
    }

    #[tokio::test]
    async fn replace_credits_for_work_stores_cast_and_crew() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        seed_work(&pool, work_id).await;
        let repo = SqlxCreditRepo::new(pool);

        let actor = sample_person("Mary Elizabeth Winstead", 17628);
        let director = sample_person("Dan Trachtenberg", 116582);
        repo.upsert_person(&actor).await.unwrap();
        repo.upsert_person(&director).await.unwrap();

        let credits = vec![
            Credit {
                id: Uuid::new_v4(),
                work_id,
                person_id: actor.id,
                role: CreditRole::Cast {
                    character: "Michelle".to_string(),
                },
                order: 1,
            },
            Credit {
                id: Uuid::new_v4(),
                work_id,
                person_id: director.id,
                role: CreditRole::Crew {
                    department: "Directing".to_string(),
                    job: "Director".to_string(),
                },
                order: 0,
            },
        ];
        repo.replace_credits_for_work(work_id, &credits)
            .await
            .unwrap();

        let fetched = repo.list_for_work(work_id).await.unwrap();
        assert_eq!(fetched.len(), 2);
        // Ordered by `order` ascending -- the director (order 0) first.
        assert_eq!(fetched[0].person_id, director.id);
        assert_eq!(
            fetched[0].role,
            CreditRole::Crew {
                department: "Directing".to_string(),
                job: "Director".to_string(),
            }
        );
        assert_eq!(fetched[1].person_id, actor.id);
        assert_eq!(
            fetched[1].role,
            CreditRole::Cast {
                character: "Michelle".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn replace_credits_for_work_is_a_full_reconciliation() {
        let pool = test_sqlite_pool().await;
        let work_id = Uuid::new_v4();
        seed_work(&pool, work_id).await;
        let repo = SqlxCreditRepo::new(pool);
        let person = sample_person("Someone", 1);
        repo.upsert_person(&person).await.unwrap();

        let first_pass = vec![Credit {
            id: Uuid::new_v4(),
            work_id,
            person_id: person.id,
            role: CreditRole::Cast {
                character: "A Role".to_string(),
            },
            order: 0,
        }];
        repo.replace_credits_for_work(work_id, &first_pass)
            .await
            .unwrap();
        assert_eq!(repo.list_for_work(work_id).await.unwrap().len(), 1);

        // Second pass with an empty slice clears every credit -- e.g. the
        // source dropped this movie's credit data entirely.
        repo.replace_credits_for_work(work_id, &[]).await.unwrap();
        assert_eq!(repo.list_for_work(work_id).await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn list_work_ids_for_person_finds_every_distinct_work() {
        let pool = test_sqlite_pool().await;
        let work_a = Uuid::new_v4();
        let work_b = Uuid::new_v4();
        seed_work(&pool, work_a).await;
        seed_work(&pool, work_b).await;
        let repo = SqlxCreditRepo::new(pool);
        let person = sample_person("Prolific Actor", 42);
        repo.upsert_person(&person).await.unwrap();

        for work_id in [work_a, work_b] {
            repo.replace_credits_for_work(
                work_id,
                &[Credit {
                    id: Uuid::new_v4(),
                    work_id,
                    person_id: person.id,
                    role: CreditRole::Cast {
                        character: "A Role".to_string(),
                    },
                    order: 0,
                }],
            )
            .await
            .unwrap();
        }

        let mut work_ids = repo.list_work_ids_for_person(person.id).await.unwrap();
        work_ids.sort();
        let mut expected = vec![work_a, work_b];
        expected.sort();
        assert_eq!(work_ids, expected);
    }

    #[tokio::test]
    async fn get_missing_person_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxCreditRepo::new(pool);
        let err = repo.get_person(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }
}
