use std::fmt;

use http::header::{COOKIE, REFERER};
use http::{HeaderMap, HeaderValue};
use url::Url;

#[derive(Clone, Default, PartialEq, Eq)]
pub struct Origin {
    referrer: Option<Url>,
    cookies: Option<String>,
    user_agent: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OriginError {
    #[error("the referrer isn't a web address")]
    Referrer,
    #[error("the cookies can't be sent as a header")]
    Cookies,
    #[error("the User-Agent can't be sent as a header")]
    UserAgent,
}

fn present(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn header(value: Option<&str>, error: OriginError) -> Result<Option<String>, OriginError> {
    present(value)
        .map(|value| {
            HeaderValue::from_str(value)
                .map(|_| value.to_owned())
                .map_err(|_| error)
        })
        .transpose()
}

impl Origin {
    pub fn new(
        referrer: Option<&str>,
        cookies: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<Self, OriginError> {
        let referrer = present(referrer)
            .map(|referrer| {
                let mut url = Url::parse(referrer)
                    .ok()
                    .filter(|url| matches!(url.scheme(), "http" | "https"))
                    .ok_or(OriginError::Referrer)?;
                url.set_fragment(None);
                url.set_username("").map_err(|()| OriginError::Referrer)?;
                url.set_password(None).map_err(|()| OriginError::Referrer)?;
                Ok(url)
            })
            .transpose()?;
        Ok(Self {
            referrer,
            cookies: header(cookies, OriginError::Cookies)?,
            user_agent: header(user_agent, OriginError::UserAgent)?,
        })
    }

    pub const fn referrer(&self) -> Option<&Url> {
        self.referrer.as_ref()
    }

    pub fn cookies(&self) -> Option<&str> {
        self.cookies.as_deref()
    }

    pub fn user_agent(&self) -> Option<&str> {
        self.user_agent.as_deref()
    }

    pub const fn is_empty(&self) -> bool {
        self.referrer.is_none() && self.cookies.is_none() && self.user_agent.is_none()
    }

    pub(crate) fn headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(Ok(value)) = self
            .referrer
            .as_ref()
            .map(|r| HeaderValue::from_str(r.as_str()))
        {
            headers.insert(REFERER, value);
        }
        if let Some(Ok(mut value)) = self.cookies.as_deref().map(HeaderValue::from_str) {
            value.set_sensitive(true);
            headers.insert(COOKIE, value);
        }
        headers
    }
}

impl fmt::Debug for Origin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Origin")
            .field("referrer", &self.referrer.as_ref().map(Url::as_str))
            .field("cookies", &self.cookies.as_ref().map(|_| "(hidden)"))
            .field("user_agent", &self.user_agent)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn blanks_count_as_absent() {
        let origin = Origin::new(Some("  "), Some(""), None).unwrap();
        assert!(origin.is_empty());
        assert!(origin.headers().is_empty());
    }

    #[test]
    fn the_referrer_loses_its_fragment_and_credentials() {
        let origin = Origin::new(
            Some("https://me:secret@example.org/page?q=1#part"),
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            origin.referrer().map(Url::as_str),
            Some("https://example.org/page?q=1")
        );
        assert_eq!(origin.headers()[REFERER], "https://example.org/page?q=1");
    }

    #[test]
    fn bad_values_are_refused_by_field() {
        assert_eq!(
            Origin::new(Some("file:///etc/passwd"), None, None),
            Err(OriginError::Referrer)
        );
        assert_eq!(
            Origin::new(Some("not a link"), None, None),
            Err(OriginError::Referrer)
        );
        assert_eq!(
            Origin::new(None, Some("a=1\r\nX-Evil: 1"), None),
            Err(OriginError::Cookies)
        );
        assert_eq!(
            Origin::new(None, None, Some("Mozi\nlla/5.0")),
            Err(OriginError::UserAgent)
        );
    }

    #[test]
    fn cookies_go_out_as_a_sensitive_header_and_never_print() {
        let origin = Origin::new(None, Some("session=abc123"), Some("Mozilla/5.0")).unwrap();
        let headers = origin.headers();
        assert_eq!(headers[COOKIE], "session=abc123");
        assert!(headers[COOKIE].is_sensitive());
        assert!(!headers.contains_key(http::header::USER_AGENT));
        assert!(!format!("{origin:?}").contains("abc123"));
    }
}
