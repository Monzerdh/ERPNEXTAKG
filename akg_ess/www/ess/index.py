no_cache = 1
no_sitemap = 1
no_breadcrumbs = 1


def get_context(context):
    # The PWA shell at www/ess/index.html is a complete <!DOCTYPE html>
    # document with all its own assets, so we don't want Frappe's website
    # wrapper (navbar, breadcrumbs, footer) injected around it.
    context.no_cache = 1
    context.no_sitemap = 1
    context.no_breadcrumbs = 1
    context.title = "AKG ESS"
    return context
