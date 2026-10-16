# Instagram Deep Research

Connect one Instagram profile node. Choose profile information, public contacts, masked recovery details, follower/following lists, posts/comments, highlights or current stories in the tool detail view. Counts and time limits still apply. Login/session settings and the global **Toutatis** source switch are in the plugin settings; a manual confirmation-code dialog is available when Instagram requires it.

[Toutatis by megadose](https://github.com/megadose/toutatis), pinned to PyPI release **1.31**, supplements accessible profile fields and masked e-mail/phone hints. Masked recovery details have their own collection section. The hints remain value nodes containing the returned mask, not normalized full e-mail/phone identities. Provenance identifies Toutatis and marks these values as masked.

The adapter calls upstream's profile read and `advanced_lookup` functions in a bounded subprocess. The lookup requires `skip_recovery=1`; reset/recovery-delivery endpoints and redirects are not allowed by the adapter. This does not guarantee Instagram will return hints for a particular account. Missing data, authentication requirements, rate limits and incomplete collection remain visible as warnings/error nodes alongside collected results.

Toutatis can be switched off globally without disabling the rest of Instagram Deep Research. Credentials and sessions are not copied into node provenance. Toutatis's GPL-3.0 terms remain applicable to that external dependency; ARGUS's license does not replace them. See [THIRD_PARTY.md](../THIRD_PARTY.md).
