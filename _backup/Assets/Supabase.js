var Supabase = pc.createScript('supabase');

Supabase.attributes.add('projectUrl', {
    type: 'string',
});

Supabase.attributes.add('anonKey', {
    type: 'string',
});

Supabase.attributes.add('labelLoggedInStatus', {
    type: 'entity',
});

Supabase.attributes.add('labelUsername', {
    type: 'entity',
});


Supabase.prototype.initialize = async function() {
    pc.supabase = this;
    this.api = supabase.createClient(
        this.projectUrl,
        this.anonKey
    );


    this.api.auth.onAuthStateChange((event, session) => this.onAuthStateChange(event, session));
    this.user = await this.getCurrentUser();
    this.labelUsername.element.text = this.user.id;
};

Supabase.prototype.loginEmail = async function(email, password) {
    const { data, error } = await this.api.auth.signInWithPassword({
        email,
        password
    })
    
    if (error) {
        console.error('Login error:', error.message)
        return null
    }
    
    return data.user
}

Supabase.prototype.signupEmail = async function(email, password){
    const { data, error } = await this.api.auth.signUp({
        email,
        password,
    })
}

Supabase.prototype.onAuthStateChange = function (event, session){
    switch (event) {
        case 'SIGNED_IN':
        console.log('User signed in:', session?.user)
        this.labelLoggedInStatus.element.text = 'Logged in';
        break
        
        case 'SIGNED_OUT':
        console.log('User signed out')
        this.labelLoggedInStatus.element.text = 'Logged out';
        break

    }
}

Supabase.prototype.isUserLoggedIn = async function() {
  const user = await this.getCurrentUser()
  return user !== null
}

Supabase.prototype.getCurrentUser = async function() {
  const { data: { user }, error } = await this.api.auth.getUser()
  
  if (error) {
    console.error('Error getting user:', error.message)
    return null
  }
  
  return user
}
