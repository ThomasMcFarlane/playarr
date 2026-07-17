$ORIGIN relay.playarr.app.
$TTL 300

@ IN SOA relay-ns1.playarr.app. hostmaster.playarr.app. (
    2026071701 ; serial
    3600       ; refresh
    900        ; retry
    604800     ; expire
    60         ; negative cache TTL
)

@ IN NS relay-ns1.playarr.app.
@ IN CAA 0 issue "letsencrypt.org"
@ IN CAA 0 issuewild ";"
* IN CAA 0 issue "letsencrypt.org"
* IN CAA 0 issuewild ";"
