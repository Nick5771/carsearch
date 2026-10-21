# Blocked profile actions — v350

- Keep Follow and Message visible on the blocker’s profile view. Follow remains labelled Follow and tapping it shows “Unblock user to follow” without making a follow request.
- Allow outbound messages from the blocker, while blocking replies from the blocked account. Recipient privacy settings and reciprocal blocks still prevent sending.
- Enforce direction at profile/listing conversation entry, the message POST endpoint, reactions, typing and message notification gates. Rejected replies never create message rows or successful send acknowledgements.
- Return current send permission with the conversation. Explain one-way messaging above the composer for the blocker, and disable the composer with a generic unavailable message for a blocked sender. Clear that state when unblocking restores permission.

Validation: 53 repository account/discovery checks passed, with a new full-endpoint directional messaging test and expanded profile/composer UI tests. Text, photo and shared-listing replies are rejected without writes; mutual blocks, message privacy settings, unblock restoration and notification direction are covered. Physical iPhone verification remains necessary. No native Xcode source changed.
