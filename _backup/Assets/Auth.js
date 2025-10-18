
var Auth = pc.createScript('auth');

Auth.attributes.add('authApiPath', {
    type: 'string',
});

Auth.prototype.initialize = function() {
    this.apiUrl = pc.supabase.apiUrl + this.authApiPath;
    pc.auth = this;
};

Auth.prototype.signUp = async function(email, password) {
    try {
        const response = await fetch(`${this.apiUrl}signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                password: password
            })
        });

        const data = await response.json();
        console.log('Signup response:', data);
        
        if (data.success) {
            console.log('Signed up successfully!');
            return data;
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error('Signup error:', error);
        throw error;
    }
}
